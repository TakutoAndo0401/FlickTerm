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
pub enum AppLanguage {
    En,
    Ja,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSettings {
    pub command_panel_width: u16,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub font_family: String,
    pub font_size: u16,
    pub letter_spacing: f64,
    pub line_height: f64,
    pub cursor_style: CursorStyle,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CursorStyle {
    Block,
    Bar,
    Underline,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistorySettings {
    pub enabled: bool,
    pub max_entries: usize,
    pub shell_integration: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutosuggestionSettings {
    pub enabled: bool,
    pub accept_with_tab: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRestoreSettings {
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureSettings {
    pub command_history: CommandHistorySettings,
    pub autosuggestions: AutosuggestionSettings,
    pub session_restore: SessionRestoreSettings,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub language: AppLanguage,
    pub commands: Vec<QuickCommand>,
    pub shortcuts: HashMap<String, ShortcutBinding>,
    pub layout: LayoutSettings,
    pub appearance: AppearanceSettings,
    pub features: FeatureSettings,
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
    pub data: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub id: String,
    pub exit_code: i32,
    pub signal: Option<i32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryEntry {
    pub command: String,
    pub cwd: Option<String>,
    pub run_count: u32,
    pub first_run_at: String,
    pub last_run_at: String,
    pub last_exit_code: Option<i32>,
    pub last_duration_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryRecordRequest {
    pub command: String,
    pub cwd: Option<String>,
    pub max_entries: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationStatusEvent {
    pub id: String,
    pub detected: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionTab {
    pub id: String,
    pub title: String,
    pub shell: String,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub serialized: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionsSnapshot {
    pub version: u8,
    pub active_tab_id: Option<String>,
    pub tabs: Vec<TerminalSessionTab>,
    pub closed_tabs: Vec<TerminalSessionTab>,
}

impl Default for TerminalSessionsSnapshot {
    fn default() -> Self {
        Self {
            version: 1,
            active_tab_id: None,
            tabs: Vec::new(),
            closed_tabs: Vec::new(),
        }
    }
}
