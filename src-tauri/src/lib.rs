mod command_history;
mod settings;
mod shell_integration;
mod terminal;
mod terminal_sessions;
mod types;

use command_history::CommandHistoryStore;
use settings::SettingsStore;
use std::sync::Arc;
use tauri::{Manager, State};
use terminal::PtyManager;
use terminal_sessions::TerminalSessionsStore;
use types::{
    AppSettings, AppSettingsSnapshot, CommandHistoryEntry, CommandHistoryRecordRequest,
    CreateTerminalRequest, CreateTerminalResponse, QuickCommand, TerminalKillRequest,
    TerminalResizeRequest, TerminalSessionsSnapshot, TerminalWriteRequest,
};

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
