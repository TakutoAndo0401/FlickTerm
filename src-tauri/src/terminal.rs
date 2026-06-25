use crate::{
    command_history::CommandHistoryStore,
    settings::SettingsStore,
    settings::default_shell,
    types::{
        CommandHistoryRecordRequest, CreateTerminalRequest, ShellIntegrationStatusEvent,
        TerminalDataEvent, TerminalExitEvent, TerminalTab,
    },
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
const MAX_OSC_BUFFER_BYTES: usize = 64 * 1024;
const MAX_SHELL_COMMAND_BYTES: usize = 8192;
const MAX_SHELL_CWD_BYTES: usize = 4096;
const SHELL_INTEGRATION_TOKEN_BYTES: usize = 32;
const FLICKTERM_SHELL_INTEGRATION_TOKEN_ENV: &str = "FLICKTERM_SHELL_INTEGRATION_TOKEN";
const FLICKTERM_OSC_PREFIX: &[u8] = b"7777;FlickTermExecutedCommand;";
const FLICKTERM_READY_OSC_PREFIX: &[u8] = b"7777;FlickTermShellIntegrationReady;";

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
        settings: Arc<SettingsStore>,
        command_history: Arc<CommandHistoryStore>,
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
        let cwd = resolve_starting_cwd(request.cwd.as_deref());
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
        let shell_integration_token = generate_shell_integration_token()
            .map_err(|error| PtyError::Spawn(error.to_string()))?;
        command.env(
            FLICKTERM_SHELL_INTEGRATION_TOKEN_ENV,
            &shell_integration_token,
        );

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

        self.spawn_reader(
            request.id.clone(),
            app.clone(),
            reader,
            settings,
            command_history,
            shell_integration_token,
        );
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

    fn spawn_reader(
        &self,
        id: String,
        app: AppHandle,
        mut reader: Box<dyn Read + Send>,
        settings: Arc<SettingsStore>,
        command_history: Arc<CommandHistoryStore>,
        shell_integration_token: String,
    ) {
        thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            let mut output_parser = TerminalOutputParser::new(shell_integration_token);
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => {
                        let parsed = output_parser.push(&buffer[..size]);
                        if let Some(cwd) = parsed.shell_integration_cwd {
                            let _ = app.emit(
                                "shell-integration:status",
                                ShellIntegrationStatusEvent {
                                    id: id.clone(),
                                    detected: true,
                                    cwd: Some(cwd),
                                },
                            );
                        }
                        for command in parsed.commands {
                            record_shell_command(&id, &app, &settings, &command_history, command);
                        }
                        if !parsed.data.is_empty() {
                            let _ = app.emit(
                                "terminal:data",
                                TerminalDataEvent {
                                    id: id.clone(),
                                    data: parsed.data,
                                },
                            );
                        }
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

struct TerminalOutputParser {
    pending: Vec<u8>,
    shell_integration_token: String,
}

struct ParsedTerminalOutput {
    data: Vec<u8>,
    commands: Vec<ShellExecutedCommand>,
    shell_integration_cwd: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct ShellExecutedCommand {
    command: String,
    cwd: Option<String>,
}

impl TerminalOutputParser {
    fn new(shell_integration_token: String) -> Self {
        Self {
            pending: Vec::new(),
            shell_integration_token,
        }
    }

    fn push(&mut self, data: &[u8]) -> ParsedTerminalOutput {
        self.pending.extend_from_slice(data);

        let mut visible = Vec::new();
        let mut commands = Vec::new();
        let mut shell_integration_cwd = None;
        let mut index = 0;

        while index < self.pending.len() {
            let Some(start_offset) = find_bytes(&self.pending[index..], b"\x1b]") else {
                visible.extend_from_slice(&self.pending[index..]);
                self.pending.clear();
                return ParsedTerminalOutput {
                    data: visible,
                    commands,
                    shell_integration_cwd,
                };
            };
            let start = index + start_offset;
            visible.extend_from_slice(&self.pending[index..start]);

            let content_start = start + 2;
            let Some((terminator_start, terminator_len)) =
                find_osc_terminator(&self.pending[content_start..])
            else {
                if start > 0 {
                    self.pending.drain(..start);
                }
                if self.pending.len() > MAX_OSC_BUFFER_BYTES {
                    if !is_flickterm_private_osc_sequence(&self.pending) {
                        visible.extend_from_slice(&self.pending);
                    }
                    self.pending.clear();
                }
                return ParsedTerminalOutput {
                    data: visible,
                    commands,
                    shell_integration_cwd,
                };
            };

            let content_end = content_start + terminator_start;
            let sequence_end = content_end + terminator_len;
            let content = &self.pending[content_start..content_end];
            if content.starts_with(FLICKTERM_OSC_PREFIX) {
                if let Some(command) =
                    parse_flickterm_command(content, &self.shell_integration_token)
                {
                    commands.push(command);
                }
            } else if content.starts_with(FLICKTERM_READY_OSC_PREFIX) {
                if let Some(cwd) = parse_flickterm_ready_cwd(content, &self.shell_integration_token)
                {
                    shell_integration_cwd = Some(cwd);
                }
            } else {
                visible.extend_from_slice(&self.pending[start..sequence_end]);
            }

            index = sequence_end;
        }

        self.pending.clear();
        ParsedTerminalOutput {
            data: visible,
            commands,
            shell_integration_cwd,
        }
    }
}

fn record_shell_command(
    id: &str,
    app: &AppHandle,
    settings: &SettingsStore,
    command_history: &CommandHistoryStore,
    command: ShellExecutedCommand,
) {
    let settings = match settings.get_settings() {
        Ok(settings) => settings,
        Err(error) => {
            eprintln!("Failed to read settings for shell integration: {error}");
            return;
        }
    };

    if !settings.features.command_history.enabled
        || !settings.features.command_history.shell_integration
    {
        return;
    }

    let command_text = command.command.trim_end().to_string();
    if command_text.trim().is_empty()
        || command_text.starts_with(' ')
        || command_text.len() > MAX_SHELL_COMMAND_BYTES
        || has_unsupported_control(&command_text)
    {
        return;
    }

    let cwd = command.cwd.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty()
            || trimmed.len() > MAX_SHELL_CWD_BYTES
            || has_unsupported_control(trimmed)
        {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    let result = command_history.record(CommandHistoryRecordRequest {
        command: command_text,
        cwd: cwd.clone(),
        max_entries: settings.features.command_history.max_entries,
    });

    match result {
        Ok(entries) => {
            let _ = app.emit("command-history:updated", entries);
            let _ = app.emit(
                "shell-integration:status",
                ShellIntegrationStatusEvent {
                    id: id.to_string(),
                    detected: true,
                    cwd,
                },
            );
        }
        Err(error) => {
            eprintln!("Failed to record shell integration command history: {error}");
        }
    }
}

fn parse_flickterm_command(
    content: &[u8],
    shell_integration_token: &str,
) -> Option<ShellExecutedCommand> {
    if shell_integration_token.is_empty() {
        return None;
    }

    let payload = content.strip_prefix(FLICKTERM_OSC_PREFIX)?;
    let payload = std::str::from_utf8(payload).ok()?;
    let mut token = None;
    let mut command = None;
    let mut cwd = None;

    for part in payload.split(';') {
        let Some((key, value)) = part.split_once('=') else {
            continue;
        };
        match key {
            "token" => token = percent_decode(value),
            "command" => command = percent_decode(value),
            "cwd" => cwd = percent_decode(value),
            _ => {}
        }
    }

    if token.as_deref() != Some(shell_integration_token) {
        return None;
    }

    command.map(|command| ShellExecutedCommand { command, cwd })
}

fn parse_flickterm_ready_cwd(content: &[u8], shell_integration_token: &str) -> Option<String> {
    if shell_integration_token.is_empty() {
        return None;
    }

    let payload = content.strip_prefix(FLICKTERM_READY_OSC_PREFIX)?;
    let payload = std::str::from_utf8(payload).ok()?;
    let mut token = None;
    let mut cwd = None;

    for part in payload.split(';') {
        let Some((key, value)) = part.split_once('=') else {
            continue;
        };
        match key {
            "token" => token = percent_decode(value),
            "cwd" => cwd = percent_decode(value),
            _ => {}
        }
    }

    if token.as_deref() == Some(shell_integration_token) {
        cwd
    } else {
        None
    }
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return None;
            }
            let high = hex_value(bytes[index + 1])?;
            let low = hex_value(bytes[index + 2])?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }

    String::from_utf8(decoded).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn generate_shell_integration_token() -> Result<String, getrandom::Error> {
    let mut bytes = [0_u8; SHELL_INTEGRATION_TOKEN_BYTES];
    getrandom::fill(&mut bytes)?;
    Ok(hex_encode(&bytes))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }

    encoded
}

fn has_unsupported_control(value: &str) -> bool {
    value
        .chars()
        .any(|character| character.is_control() && character != '\t')
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn find_osc_terminator(data: &[u8]) -> Option<(usize, usize)> {
    let bel = data.iter().position(|byte| *byte == b'\x07');
    let st = find_bytes(data, b"\x1b\\");

    match (bel, st) {
        (Some(bel), Some(st)) if bel < st => Some((bel, 1)),
        (Some(_), Some(st)) => Some((st, 2)),
        (Some(bel), None) => Some((bel, 1)),
        (None, Some(st)) => Some((st, 2)),
        (None, None) => None,
    }
}

fn is_flickterm_private_osc_sequence(data: &[u8]) -> bool {
    data.strip_prefix(b"\x1b]").is_some_and(|content| {
        content.starts_with(FLICKTERM_OSC_PREFIX) || content.starts_with(FLICKTERM_READY_OSC_PREFIX)
    })
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

fn resolve_starting_cwd(requested_cwd: Option<&str>) -> Option<PathBuf> {
    requested_cwd
        .and_then(resolve_requested_cwd)
        .or_else(dirs::home_dir)
}

fn resolve_requested_cwd(requested_cwd: &str) -> Option<PathBuf> {
    if requested_cwd.is_empty()
        || requested_cwd.len() > MAX_SHELL_CWD_BYTES
        || has_unsupported_control(requested_cwd)
    {
        return None;
    }

    let path = PathBuf::from(requested_cwd);
    if path.is_absolute() && path.is_dir() {
        Some(path)
    } else {
        None
    }
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

    const TEST_SHELL_INTEGRATION_TOKEN: &str = "test-token";

    fn test_parser() -> TerminalOutputParser {
        TerminalOutputParser::new(TEST_SHELL_INTEGRATION_TOKEN.to_string())
    }

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
    fn resolves_existing_absolute_requested_cwd() {
        let cwd = env::temp_dir();
        let cwd_text = cwd.to_string_lossy();

        assert_eq!(resolve_requested_cwd(&cwd_text), Some(cwd));
    }

    #[test]
    fn ignores_invalid_requested_cwd() {
        assert!(resolve_requested_cwd("").is_none());
        assert!(resolve_requested_cwd("relative/path").is_none());
        assert!(resolve_requested_cwd("/definitely/missing/flickterm/cwd").is_none());
        assert!(resolve_requested_cwd("/tmp/\ninvalid").is_none());
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

    #[test]
    fn extracts_flickterm_command_osc_and_keeps_visible_output() {
        let mut parser = test_parser();
        let output = parser.push(
            b"before\x1b]7777;FlickTermExecutedCommand;token=test-token;command=git%20status;cwd=/tmp\x07after",
        );

        assert_eq!(output.data, b"beforeafter");
        assert_eq!(
            output.commands,
            vec![ShellExecutedCommand {
                command: "git status".to_string(),
                cwd: Some("/tmp".to_string())
            }]
        );
    }

    #[test]
    fn passes_non_flickterm_osc_through() {
        let mut parser = test_parser();
        let output = parser.push(b"\x1b]0;title\x07prompt");

        assert_eq!(output.data, b"\x1b]0;title\x07prompt");
        assert!(output.commands.is_empty());
    }

    #[test]
    fn supports_split_flickterm_osc() {
        let mut parser = test_parser();
        let first =
            parser.push(b"before\x1b]7777;FlickTermExecutedCommand;token=test-token;command=git");
        let second = parser.push(b"%20status;cwd=/tmp\x07after");

        assert_eq!(first.data, b"before");
        assert!(first.commands.is_empty());
        assert_eq!(second.data, b"after");
        assert_eq!(
            second.commands,
            vec![ShellExecutedCommand {
                command: "git status".to_string(),
                cwd: Some("/tmp".to_string())
            }]
        );
    }

    #[test]
    fn drops_malformed_private_osc() {
        let mut parser = test_parser();
        let output =
            parser.push(b"a\x1b]7777;FlickTermExecutedCommand;token=test-token;command=%QQ\x07b");

        assert_eq!(output.data, b"ab");
        assert!(output.commands.is_empty());
    }

    #[test]
    fn detects_shell_integration_ready_osc() {
        let mut parser = test_parser();
        let output = parser
            .push(b"\x1b]7777;FlickTermShellIntegrationReady;token=test-token;cwd=/tmp\x07prompt");

        assert_eq!(output.data, b"prompt");
        assert!(output.commands.is_empty());
        assert_eq!(output.shell_integration_cwd, Some("/tmp".to_string()));
    }

    #[test]
    fn rejects_private_command_osc_without_matching_token() {
        let mut parser = test_parser();
        let forged = b"\x1b]7777;FlickTermExecutedCommand;command=git%20status;cwd=/tmp\x07prompt";
        let output = parser.push(forged);

        assert_eq!(output.data, b"prompt");
        assert!(output.commands.is_empty());
        assert!(output.shell_integration_cwd.is_none());
    }

    #[test]
    fn rejects_private_command_osc_with_wrong_token() {
        let mut parser = test_parser();
        let forged =
            b"\x1b]7777;FlickTermExecutedCommand;token=wrong;command=git%20status;cwd=/tmp\x07prompt";
        let output = parser.push(forged);

        assert_eq!(output.data, b"prompt");
        assert!(output.commands.is_empty());
        assert!(output.shell_integration_cwd.is_none());
    }

    #[test]
    fn rejects_private_ready_osc_without_matching_token() {
        let mut parser = test_parser();
        let forged = b"\x1b]7777;FlickTermShellIntegrationReady;cwd=/tmp\x07prompt";
        let output = parser.push(forged);

        assert_eq!(output.data, b"prompt");
        assert!(output.commands.is_empty());
        assert!(output.shell_integration_cwd.is_none());
    }

    #[test]
    fn rejects_private_ready_osc_with_wrong_token() {
        let mut parser = test_parser();
        let forged = b"\x1b]7777;FlickTermShellIntegrationReady;token=wrong;cwd=/tmp\x07prompt";
        let output = parser.push(forged);

        assert_eq!(output.data, b"prompt");
        assert!(output.commands.is_empty());
        assert!(output.shell_integration_cwd.is_none());
    }

    #[test]
    fn drops_oversized_unterminated_private_osc() {
        let mut parser = test_parser();
        let mut data = b"before\x1b]7777;FlickTermExecutedCommand;token=wrong;command=".to_vec();
        data.extend(std::iter::repeat_n(b'a', MAX_OSC_BUFFER_BYTES));

        let output = parser.push(&data);
        assert_eq!(output.data, b"before");
        assert!(output.commands.is_empty());

        let next = parser.push(b"after");
        assert_eq!(next.data, b"after");
        assert!(next.commands.is_empty());
    }

    #[test]
    fn generates_hex_shell_integration_token() {
        let token = generate_shell_integration_token().expect("token should be generated");

        assert_eq!(token.len(), SHELL_INTEGRATION_TOKEN_BYTES * 2);
        assert!(token.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }
}
