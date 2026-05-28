mod settings;
mod terminal;
mod types;

use settings::SettingsStore;
use tauri::{Manager, State};
use terminal::PtyManager;
use types::{
    AppSettings, AppSettingsSnapshot, CreateTerminalRequest, CreateTerminalResponse, QuickCommand,
    TerminalKillRequest, TerminalResizeRequest, TerminalWriteRequest,
};

struct AppState {
    settings: SettingsStore,
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
fn terminal_create(
    request: CreateTerminalRequest,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<CreateTerminalResponse, String> {
    state
        .pty
        .create(request, app)
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
        .setup(|app| {
            let settings = SettingsStore::new(app.handle().clone())?;
            settings.load()?;

            app.manage(AppState {
                settings,
                pty: PtyManager::default(),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            quick_commands_list,
            settings_get,
            settings_save,
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
