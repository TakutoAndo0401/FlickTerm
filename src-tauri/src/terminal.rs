use crate::{
    settings::default_shell,
    types::{CreateTerminalRequest, TerminalDataEvent, TerminalExitEvent, TerminalTab},
};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::{
    collections::HashMap,
    env,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

const INITIAL_COLS: u16 = 80;
const INITIAL_ROWS: u16 = 24;
const MAX_COLS: u16 = 500;
const MAX_ROWS: u16 = 200;
const MAX_TERMINAL_ID_LEN: usize = 80;
const MAX_TERMINAL_WRITE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Error)]
pub enum PtyError {
    #[error("Terminal already exists: {0}")]
    Duplicate(String),
    #[error("Terminal was not found: {0}")]
    Missing(String),
    #[error("PTY lock was poisoned.")]
    Lock,
    #[error("Invalid terminal request: {0}")]
    Invalid(String),
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
        validate_terminal_id(&request.id)?;

        {
            let sessions = self.sessions.lock().map_err(|_| PtyError::Lock)?;
            if sessions.contains_key(&request.id) {
                return Err(PtyError::Duplicate(request.id));
            }
        }

        let shell = resolve_shell();
        let title = normalize_title(request.title.as_deref(), &shell);
        let cwd = dirs::home_dir();
        let tab = TerminalTab {
            id: request.id.clone(),
            title,
            shell: shell.clone(),
            cwd: cwd
                .as_ref()
                .and_then(|path| path.to_str().map(String::from)),
        };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: normalize_size(request.rows, INITIAL_ROWS, MAX_ROWS),
                cols: normalize_size(request.cols, INITIAL_COLS, MAX_COLS),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| PtyError::Spawn(error.to_string()))?;

        let mut command = CommandBuilder::new(shell.clone());
        if should_start_as_login_shell(&shell) {
            command.arg("-l");
        }
        if let Some(cwd) = &cwd {
            command.cwd(cwd);
        }
        for (key, value) in env::vars() {
            command.env(key, value);
        }
        if let Some(path) = terminal_path_env() {
            command.env("PATH", path);
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
        validate_terminal_id(id)?;
        if data.len() > MAX_TERMINAL_WRITE_BYTES {
            return Err(PtyError::Invalid("terminal input is too large".to_string()));
        }

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
        validate_terminal_id(id)?;
        if cols < 1 || rows < 1 {
            return Ok(());
        }

        let cols = cols.min(MAX_COLS);
        let rows = rows.min(MAX_ROWS);
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
        validate_terminal_id(id)?;
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
                        let _ = app.emit(
                            "terminal:data",
                            TerminalDataEvent {
                                id: id.clone(),
                                data: buffer[..size].to_vec(),
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

fn validate_terminal_id(id: &str) -> Result<(), PtyError> {
    let is_valid = !id.is_empty()
        && id.len() <= MAX_TERMINAL_ID_LEN
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));

    if is_valid {
        Ok(())
    } else {
        Err(PtyError::Invalid("terminal id is invalid".to_string()))
    }
}

fn normalize_title(title: Option<&str>, shell: &str) -> String {
    title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(80).collect())
        .unwrap_or_else(|| shell_title(shell))
}

fn normalize_size(value: Option<u16>, default_value: u16, max_value: u16) -> u16 {
    value.unwrap_or(default_value).clamp(1, max_value)
}

fn resolve_shell() -> String {
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

fn should_start_as_login_shell(shell: &str) -> bool {
    if cfg!(windows) {
        return false;
    }

    matches!(shell_title(shell).as_str(), "bash" | "fish" | "zsh")
}

fn terminal_path_env() -> Option<String> {
    if cfg!(windows) {
        return None;
    }

    let current = env::var("PATH").unwrap_or_default();
    let entries = existing_supplemental_path_entries();
    let path = append_missing_path_entries(&current, &entries);

    (!path.is_empty()).then_some(path)
}

fn existing_supplemental_path_entries() -> Vec<String> {
    let mut paths = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/opt/homebrew/sbin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/local/sbin"),
    ];

    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".local/bin"));
        paths.push(home.join(".local/share/mise/shims"));
    }

    paths
        .into_iter()
        .filter(|path| path.is_dir())
        .filter_map(|path| path.into_os_string().into_string().ok())
        .collect()
}

fn append_missing_path_entries(current: &str, supplemental_entries: &[String]) -> String {
    let mut entries = current
        .split(':')
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    for entry in supplemental_entries {
        if !entries.iter().any(|existing| existing == entry) {
            entries.push(entry.clone());
        }
    }

    entries.join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_known_unix_shells_as_login_shells() {
        assert!(should_start_as_login_shell("/bin/zsh"));
        assert!(should_start_as_login_shell("/opt/homebrew/bin/bash"));
        assert!(should_start_as_login_shell("fish"));
    }

    #[test]
    fn does_not_add_login_flag_to_unknown_shells() {
        assert!(!should_start_as_login_shell("/bin/sh"));
        assert!(!should_start_as_login_shell("/usr/bin/false"));
    }

    #[test]
    fn accepts_only_bounded_ascii_terminal_ids() {
        assert!(validate_terminal_id("terminal-abc_123").is_ok());
        assert!(validate_terminal_id("").is_err());
        assert!(validate_terminal_id("terminal/abc").is_err());
        assert!(validate_terminal_id(&"a".repeat(MAX_TERMINAL_ID_LEN + 1)).is_err());
    }

    #[test]
    fn clamps_requested_terminal_size() {
        assert_eq!(normalize_size(None, INITIAL_COLS, MAX_COLS), INITIAL_COLS);
        assert_eq!(normalize_size(Some(0), INITIAL_COLS, MAX_COLS), 1);
        assert_eq!(
            normalize_size(Some(MAX_COLS + 1), INITIAL_COLS, MAX_COLS),
            MAX_COLS
        );
    }

    #[test]
    fn normalizes_empty_and_long_titles() {
        assert_eq!(normalize_title(None, "/bin/zsh"), "zsh");
        assert_eq!(normalize_title(Some("  "), "/bin/zsh"), "zsh");
        assert_eq!(
            normalize_title(Some(&"a".repeat(100)), "/bin/zsh").len(),
            80
        );
    }

    #[test]
    fn appends_missing_path_entries_without_duplicates() {
        let supplemental_entries = vec![
            "/opt/homebrew/bin".to_string(),
            "/Users/example/.local/bin".to_string(),
        ];

        assert_eq!(
            append_missing_path_entries("/usr/bin:/opt/homebrew/bin", &supplemental_entries),
            "/usr/bin:/opt/homebrew/bin:/Users/example/.local/bin"
        );
    }
}
