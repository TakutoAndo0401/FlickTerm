mod command_history;
mod settings;
mod shell_integration;
mod terminal;
mod terminal_sessions;
mod types;

use command_history::CommandHistoryStore;
use settings::SettingsStore;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{Manager, State};
use terminal::PtyManager;
use terminal_sessions::TerminalSessionsStore;
use types::{
    AppSettings, AppSettingsSnapshot, CommandHistoryEntry, CommandHistoryRecordRequest,
    CompletionItem, CompletionKind, CompletionRequest, CreateTerminalRequest,
    CreateTerminalResponse, QuickCommand, TerminalKillRequest, TerminalResizeRequest,
    TerminalSessionsSnapshot, TerminalWriteRequest,
};

const MAX_COMPLETION_TOKEN_LEN: usize = 512;
const MAX_COMPLETION_RESULTS: usize = 80;

struct AppState {
    settings: Arc<SettingsStore>,
    command_history: Arc<CommandHistoryStore>,
    terminal_sessions: Arc<TerminalSessionsStore>,
    pty: PtyManager,
}

#[tauri::command]
fn quick_commands_list(state: State<'_, AppState>) -> Result<Vec<QuickCommand>, String> {
    state
        .settings
        .get_settings()
        .map(|settings| settings.commands)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn settings_get(state: State<'_, AppState>) -> Result<AppSettingsSnapshot, String> {
    state
        .settings
        .get_snapshot(Vec::new())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn settings_save(
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<AppSettingsSnapshot, String> {
    state
        .settings
        .save(settings)
        .and_then(|_| state.settings.get_snapshot(Vec::new()))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn command_history_list(state: State<'_, AppState>) -> Result<Vec<CommandHistoryEntry>, String> {
    state
        .command_history
        .list()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn command_history_record(
    request: CommandHistoryRecordRequest,
    state: State<'_, AppState>,
) -> Result<Vec<CommandHistoryEntry>, String> {
    state
        .command_history
        .record(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn command_history_clear(state: State<'_, AppState>) -> Result<Vec<CommandHistoryEntry>, String> {
    state
        .command_history
        .clear()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_sessions_get(state: State<'_, AppState>) -> Result<TerminalSessionsSnapshot, String> {
    state
        .terminal_sessions
        .get()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_sessions_save(
    snapshot: TerminalSessionsSnapshot,
    state: State<'_, AppState>,
) -> Result<TerminalSessionsSnapshot, String> {
    state
        .terminal_sessions
        .save(snapshot)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_sessions_clear(state: State<'_, AppState>) -> Result<TerminalSessionsSnapshot, String> {
    state
        .terminal_sessions
        .clear()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn shell_integration_zshrc_snippet(app: tauri::AppHandle) -> Result<String, String> {
    shell_integration::zshrc_snippet(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn shell_integration_install_zshrc(app: tauri::AppHandle) -> Result<String, String> {
    shell_integration::install_zshrc_snippet(&app)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn completions_list(request: CompletionRequest) -> Result<Vec<CompletionItem>, String> {
    if request.token.len() > MAX_COMPLETION_TOKEN_LEN {
        return Ok(Vec::new());
    }

    let cwd = request
        .cwd
        .as_deref()
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .or_else(dirs::home_dir)
        .ok_or_else(|| "Home directory was not found.".to_string())?;
    let (directory, prefix) = resolve_completion_directory(&cwd, &request.token)?;
    let entries = fs::read_dir(&directory).map_err(|error| error.to_string())?;
    let show_hidden = prefix.starts_with('.');
    let mut items = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "."
            || name == ".."
            || (!show_hidden && name.starts_with('.'))
            || !name.starts_with(&prefix)
        {
            continue;
        }

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        let is_dir = file_type.is_dir();
        if request.directories_only && !is_dir {
            continue;
        }

        let suffix = if is_dir { "/" } else { "" };
        items.push(CompletionItem {
            insert_text: format!("{}{}", shell_escape_path_component(&name), suffix),
            display: format!("{name}{suffix}"),
            name,
            kind: if is_dir {
                CompletionKind::Directory
            } else {
                CompletionKind::File
            },
        });
    }

    items.sort_by(|left, right| match (&left.kind, &right.kind) {
        (CompletionKind::Directory, CompletionKind::File) => std::cmp::Ordering::Less,
        (CompletionKind::File, CompletionKind::Directory) => std::cmp::Ordering::Greater,
        _ => left
            .name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name)),
    });
    items.truncate(MAX_COMPLETION_RESULTS);
    Ok(items)
}

fn resolve_completion_directory(cwd: &Path, token: &str) -> Result<(PathBuf, String), String> {
    let unescaped = unescape_shell_token(token);
    let (directory_part, prefix) = match unescaped.rsplit_once('/') {
        Some((directory, prefix)) => (directory, prefix.to_string()),
        None => ("", unescaped),
    };

    let directory = if directory_part.is_empty() {
        cwd.to_path_buf()
    } else if directory_part == "~" {
        dirs::home_dir().ok_or_else(|| "Home directory was not found.".to_string())?
    } else if let Some(rest) = directory_part.strip_prefix("~/") {
        dirs::home_dir()
            .ok_or_else(|| "Home directory was not found.".to_string())?
            .join(rest)
    } else {
        let path = PathBuf::from(directory_part);
        if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        }
    };

    Ok((directory, prefix))
}

fn unescape_shell_token(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut escaped = false;
    for char in value.chars() {
        if escaped {
            output.push(char);
            escaped = false;
        } else if char == '\\' {
            escaped = true;
        } else {
            output.push(char);
        }
    }
    if escaped {
        output.push('\\');
    }
    output
}

fn shell_escape_path_component(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for char in value.chars() {
        if matches!(
            char,
            ' ' | '\t'
                | '\''
                | '"'
                | '\\'
                | '$'
                | '&'
                | ';'
                | '('
                | ')'
                | '['
                | ']'
                | '{'
                | '}'
                | '|'
                | '<'
                | '>'
                | '*'
                | '?'
                | '!'
        ) {
            output.push('\\');
        }
        output.push(char);
    }
    output
}

#[tauri::command]
fn terminal_create(
    request: CreateTerminalRequest,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<CreateTerminalResponse, String> {
    state
        .pty
        .create(
            request,
            app,
            Arc::clone(&state.settings),
            Arc::clone(&state.command_history),
        )
        .map(|tab| CreateTerminalResponse { tab })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_write(request: TerminalWriteRequest, state: State<'_, AppState>) -> Result<(), String> {
    state
        .pty
        .write(&request.id, &request.data)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_resize(
    request: TerminalResizeRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .pty
        .resize(&request.id, request.cols, request.rows)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_kill(request: TerminalKillRequest, state: State<'_, AppState>) -> Result<(), String> {
    state
        .pty
        .kill(&request.id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn window_toggle_visibility(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window was not found.".to_string())?;

    if window.is_visible().map_err(|error| error.to_string())? {
        window.hide().map_err(|error| error.to_string())?;
    } else {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    }

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            shell_integration::ensure_shell_integration_files(app.handle())?;
            let settings = Arc::new(SettingsStore::new(app.handle().clone())?);
            settings.load()?;
            let command_history = Arc::new(CommandHistoryStore::new(app.handle().clone())?);
            command_history.load()?;
            let terminal_sessions = Arc::new(TerminalSessionsStore::new(app.handle().clone())?);
            terminal_sessions.load()?;

            app.manage(AppState {
                settings,
                command_history,
                terminal_sessions,
                pty: PtyManager::default(),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            quick_commands_list,
            settings_get,
            settings_save,
            command_history_list,
            command_history_record,
            command_history_clear,
            terminal_sessions_get,
            terminal_sessions_save,
            terminal_sessions_clear,
            shell_integration_zshrc_snippet,
            shell_integration_install_zshrc,
            completions_list,
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_kill,
            window_toggle_visibility
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let app = window.app_handle();
                if let Some(state) = app.try_state::<AppState>() {
                    state.pty.kill_all();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
