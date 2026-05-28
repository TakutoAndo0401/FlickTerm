use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalTab {
    pub id: String,
    pub title: String,
    pub shell: String,
    pub cwd: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickCommand {
    pub id: String,
    pub label: String,
    pub command: String,
    pub run_mode: QuickCommandRunMode,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum QuickCommandRunMode {
    Send,
    Insert,
    Confirm,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutScope {
    Global,
    App,
    Disabled,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBinding {
    pub accelerator: String,
    pub scope: ShortcutScope,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSettings {
    pub command_panel_width: u16,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub commands: Vec<QuickCommand>,
    pub shortcuts: HashMap<String, ShortcutBinding>,
    pub layout: LayoutSettings,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutRegistrationError {
    pub action_id: String,
    pub accelerator: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsSnapshot {
    pub settings: AppSettings,
    pub defaults: AppSettings,
    pub global_shortcut_errors: Vec<ShortcutRegistrationError>,
    pub notice: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalRequest {
    pub id: String,
    pub title: Option<String>,
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalResponse {
    pub tab: TerminalTab,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteRequest {
    pub id: String,
    pub data: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeRequest {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalKillRequest {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDataEvent {
    pub id: String,
    pub data: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub id: String,
    pub exit_code: i32,
    pub signal: Option<i32>,
}
