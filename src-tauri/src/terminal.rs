use crate::{
    settings::default_shell,
    types::{CreateTerminalRequest, TerminalDataEvent, TerminalExitEvent, TerminalTab},
};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::{
    collections::HashMap,
    env,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

const INITIAL_COLS: u16 = 80;
const INITIAL_ROWS: u16 = 24;

#[derive(Debug, Error)]
pub enum PtyError {
    #[error("Terminal already exists: {0}")]
    Duplicate(String),
    #[error("Terminal was not found: {0}")]
    Missing(String),
    #[error("PTY lock was poisoned.")]
    Lock,
    #[error("Failed to spawn terminal: {0}")]
    Spawn(String),
    #[error("Failed to write to terminal: {0}")]
    Write(String),
    #[error("Failed to resize terminal: {0}")]
    Resize(String),
    #[error("Failed to kill terminal: {0}")]
    Kill(String),
}

type PtyWriter = Box<dyn Write + Send>;
type PtyChild = Box<dyn Child + Send + Sync>;

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<PtyWriter>>,
    child: Arc<Mutex<PtyChild>>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyManager {
    pub fn create(
        &self,
        request: CreateTerminalRequest,
        app: AppHandle,
    ) -> Result<TerminalTab, PtyError> {
        {
            let sessions = self.sessions.lock().map_err(|_| PtyError::Lock)?;
            if sessions.contains_key(&request.id) {
                return Err(PtyError::Duplicate(request.id));
            }
        }

        let shell = resolve_shell(request.shell.as_deref());
        let title = request.title.clone().unwrap_or_else(|| shell_title(&shell));
        let tab = TerminalTab {
            id: request.id.clone(),
            title,
            shell: shell.clone(),
            cwd: request.cwd.clone(),
        };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: request.rows.unwrap_or(INITIAL_ROWS),
                cols: request.cols.unwrap_or(INITIAL_COLS),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| PtyError::Spawn(error.to_string()))?;

        let mut command = CommandBuilder::new(shell);
        if let Some(cwd) = &request.cwd {
            command.cwd(cwd);
        } else if let Some(home) = dirs::home_dir() {
            command.cwd(home);
        }
        for (key, value) in env::vars() {
            command.env(key, value);
        }
        command.env("TERM", "xterm-256color");

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| PtyError::Spawn(error.to_string()))?;
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| PtyError::Spawn(error.to_string()))?;
        let writer = Arc::new(Mutex::new(
            pair.master
                .take_writer()
                .map_err(|error| PtyError::Spawn(error.to_string()))?,
        ));

        let child = Arc::new(Mutex::new(child));
        let session = PtySession {
            master: pair.master,
            writer: Arc::clone(&writer),
            child: Arc::clone(&child),
        };

        self.sessions
            .lock()
            .map_err(|_| PtyError::Lock)?
            .insert(request.id.clone(), session);

        self.spawn_reader(request.id.clone(), app.clone(), reader);
        self.spawn_waiter(request.id, app, child);

        Ok(tab)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), PtyError> {
        let writer = {
            let sessions = self.sessions.lock().map_err(|_| PtyError::Lock)?;
            sessions
                .get(id)
                .map(|session| Arc::clone(&session.writer))
                .ok_or_else(|| PtyError::Missing(id.to_string()))?
        };

        writer
            .lock()
            .map_err(|_| PtyError::Lock)?
            .write_all(data.as_bytes())
            .map_err(|error| PtyError::Write(error.to_string()))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
        if cols < 1 || rows < 1 {
            return Ok(());
        }

        let sessions = self.sessions.lock().map_err(|_| PtyError::Lock)?;
        let session = sessions
            .get(id)
            .ok_or_else(|| PtyError::Missing(id.to_string()))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| PtyError::Resize(error.to_string()))
    }

    pub fn kill(&self, id: &str) -> Result<(), PtyError> {
        let session = {
            let mut sessions = self.sessions.lock().map_err(|_| PtyError::Lock)?;
            match sessions.remove(id) {
                Some(session) => session,
                None => return Ok(()),
            }
        };

        session
            .child
            .lock()
            .map_err(|_| PtyError::Lock)?
            .kill()
            .map_err(|error| PtyError::Kill(error.to_string()))
    }

    pub fn kill_all(&self) {
        let ids = match self.sessions.lock() {
            Ok(sessions) => sessions.keys().cloned().collect::<Vec<_>>(),
            Err(_) => return,
        };

        for id in ids {
            let _ = self.kill(&id);
        }
    }

    fn spawn_reader(&self, id: String, app: AppHandle, mut reader: Box<dyn Read + Send>) {
        thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => {
                        let data = String::from_utf8_lossy(&buffer[..size]).to_string();
                        let _ = app.emit(
                            "terminal:data",
                            TerminalDataEvent {
                                id: id.clone(),
                                data,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }

    fn spawn_waiter(&self, id: String, app: AppHandle, child: Arc<Mutex<PtyChild>>) {
        let sessions = Arc::clone(&self.sessions);

        thread::spawn(move || {
            let exit_code = loop {
                let maybe_status = {
                    let mut child = match child.lock() {
                        Ok(child) => child,
                        Err(_) => return,
                    };
                    match child.try_wait() {
                        Ok(status) => status,
                        Err(_) => return,
                    }
                };

                if let Some(status) = maybe_status {
                    break status.exit_code();
                }

                thread::sleep(Duration::from_millis(80));
            };

            if let Ok(mut sessions) = sessions.lock() {
                sessions.remove(&id);
            }
            let _ = app.emit(
                "terminal:exit",
                TerminalExitEvent {
                    id,
                    exit_code: exit_code as i32,
                    signal: None,
                },
            );
        });
    }
}

fn resolve_shell(shell: Option<&str>) -> String {
    if let Some(shell) = shell.filter(|value| !value.trim().is_empty()) {
        return shell.to_string();
    }

    if cfg!(windows) {
        return env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string());
    }

    env::var("SHELL").unwrap_or_else(|_| default_shell().to_string())
}

fn shell_title(shell: &str) -> String {
    shell
        .rsplit(['/', '\\'])
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or(shell)
        .to_string()
}
