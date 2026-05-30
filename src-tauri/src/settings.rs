use crate::types::{
    AppLanguage, AppSettings, AppSettingsSnapshot, AppearanceSettings, AutosuggestionSettings,
    CommandHistorySettings, CursorStyle, FeatureSettings, LayoutSettings, QuickCommand,
    QuickCommandRunMode, ShortcutBinding, ShortcutRegistrationError, ShortcutScope,
};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::Mutex,
};
use tauri::AppHandle;
use thiserror::Error;

const SETTINGS_FILE_NAME: &str = "settings.json";
const DEFAULT_SHELL: &str = "/bin/zsh";
const TOGGLE_SHORTCUT: &str = "Alt+Space";
const DEFAULT_COMMAND_PANEL_WIDTH: u16 = 168;
const MIN_COMMAND_PANEL_WIDTH: u16 = 120;
const MAX_COMMAND_PANEL_WIDTH: u16 = 360;
const DEFAULT_FONT_FAMILY: &str = "Menlo, Monaco, Consolas, 'Courier New', monospace";
const FONT_FAMILY_OPTIONS: [&str; 3] = [
    "Menlo, Monaco, Consolas, 'Courier New', monospace",
    "Monaco, Menlo, Consolas, 'Courier New', monospace",
    "'Courier New', monospace",
];
const DEFAULT_FONT_SIZE: u16 = 13;
const MIN_FONT_SIZE: u16 = 10;
const MAX_FONT_SIZE: u16 = 28;
const DEFAULT_LETTER_SPACING: f64 = 0.0;
const MIN_LETTER_SPACING: f64 = -1.0;
const MAX_LETTER_SPACING: f64 = 4.0;
const DEFAULT_LINE_HEIGHT: f64 = 1.2;
const MIN_LINE_HEIGHT: f64 = 1.0;
const MAX_LINE_HEIGHT: f64 = 1.8;
const DEFAULT_COMMAND_HISTORY_MAX_ENTRIES: usize = 5000;
const MIN_COMMAND_HISTORY_MAX_ENTRIES: usize = 100;
const MAX_COMMAND_HISTORY_MAX_ENTRIES: usize = 50000;

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("Could not resolve the app configuration directory.")]
    ConfigDir,
    #[error("Settings lock was poisoned.")]
    Lock,
    #[error("Invalid settings: {0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

struct SettingsState {
    settings: AppSettings,
    notice: Option<String>,
}

pub struct SettingsStore {
    path: PathBuf,
    state: Mutex<SettingsState>,
}

impl SettingsStore {
    pub fn new(app: AppHandle) -> Result<Self, SettingsError> {
        let config_dir = dirs::config_dir()
            .ok_or(SettingsError::ConfigDir)?
            .join(app.config().product_name.as_deref().unwrap_or("FlickTerm"));

        Ok(Self {
            path: config_dir.join(SETTINGS_FILE_NAME),
            state: Mutex::new(SettingsState {
                settings: default_settings(),
                notice: None,
            }),
        })
    }

    pub fn load(&self) -> Result<(), SettingsError> {
        let (settings, notice) = self.read_from_disk()?;
        {
            let mut state = self.state.lock().map_err(|_| SettingsError::Lock)?;
            state.settings = settings;
            state.notice = notice;
        }
        self.persist()
    }

    pub fn get_snapshot(
        &self,
        global_shortcut_errors: Vec<ShortcutRegistrationError>,
    ) -> Result<AppSettingsSnapshot, SettingsError> {
        let state = self.state.lock().map_err(|_| SettingsError::Lock)?;
        Ok(AppSettingsSnapshot {
            settings: state.settings.clone(),
            defaults: default_settings(),
            global_shortcut_errors,
            notice: state.notice.clone(),
        })
    }

    pub fn get_settings(&self) -> Result<AppSettings, SettingsError> {
        let state = self.state.lock().map_err(|_| SettingsError::Lock)?;
        Ok(state.settings.clone())
    }

    pub fn save(&self, settings: AppSettings) -> Result<(), SettingsError> {
        {
            let mut state = self.state.lock().map_err(|_| SettingsError::Lock)?;
            state.settings = normalize_settings(serde_json::to_value(settings)?)?;
            state.notice = None;
        }
        self.persist()
    }

    fn read_from_disk(&self) -> Result<(AppSettings, Option<String>), SettingsError> {
        match fs::read_to_string(&self.path) {
            Ok(raw) => {
                let value = serde_json::from_str::<Value>(&raw)?;
                match normalize_settings(value) {
                    Ok(settings) => Ok((settings, None)),
                    Err(error) => {
                        self.backup_invalid_settings()?;
                        Ok((
                            default_settings(),
                            Some(format!(
                                "Settings file was invalid and has been reset. {error}"
                            )),
                        ))
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok((default_settings(), None))
            }
            Err(error) => {
                self.backup_invalid_settings()?;
                Ok((
                    default_settings(),
                    Some(format!(
                        "Settings file was invalid and has been reset. {error}"
                    )),
                ))
            }
        }
    }

    fn persist(&self) -> Result<(), SettingsError> {
        let settings = {
            let state = self.state.lock().map_err(|_| SettingsError::Lock)?;
            state.settings.clone()
        };
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(
            &self.path,
            format!("{}\n", serde_json::to_string_pretty(&settings)?),
        )?;
        Ok(())
    }

    fn backup_invalid_settings(&self) -> Result<(), SettingsError> {
        if !self.path.exists() {
            return Ok(());
        }

        let stamp = chrono_like_stamp();
        let backup_path = self
            .path
            .with_file_name(format!("settings.invalid-{stamp}.json"));
        fs::rename(&self.path, backup_path)?;
        Ok(())
    }
}

fn normalize_settings(value: Value) -> Result<AppSettings, SettingsError> {
    let object = value
        .as_object()
        .ok_or_else(|| SettingsError::Invalid("Settings must be an object.".to_string()))?;

    let commands = normalize_commands(object.get("commands"))?;
    let command_ids = commands
        .iter()
        .map(|command| command.id.clone())
        .collect::<HashSet<_>>();
    let shortcuts = normalize_shortcuts(object.get("shortcuts"), &command_ids)?;
    let language = normalize_language(object.get("language"));
    let layout = normalize_layout(object.get("layout"));
    let appearance = normalize_appearance(object.get("appearance"));
    let features = normalize_features(object.get("features"));

    Ok(AppSettings {
        language,
        commands,
        shortcuts,
        layout,
        appearance,
        features,
    })
}

fn normalize_language(value: Option<&Value>) -> AppLanguage {
    match value.and_then(Value::as_str) {
        Some("ja") => AppLanguage::Ja,
        _ => AppLanguage::En,
    }
}

fn normalize_commands(value: Option<&Value>) -> Result<Vec<QuickCommand>, SettingsError> {
    let array = value
        .and_then(Value::as_array)
        .ok_or_else(|| SettingsError::Invalid("Settings commands must be an array.".to_string()))?;

    let mut seen = HashSet::new();
    let mut commands = Vec::with_capacity(array.len());

    for item in array {
        let object = item
            .as_object()
            .ok_or_else(|| SettingsError::Invalid("Command must be an object.".to_string()))?;
        let id = read_required_string(object.get("id"), "Command id")?;
        let label = read_required_string(object.get("label"), "Command label")?;
        let command = read_required_string(object.get("command"), "Command text")?;
        let run_mode = match object.get("runMode").and_then(Value::as_str) {
            Some("send") => QuickCommandRunMode::Send,
            Some("insert") => QuickCommandRunMode::Insert,
            Some("confirm") => QuickCommandRunMode::Confirm,
            Some(other) => {
                return Err(SettingsError::Invalid(format!(
                    "Invalid command run mode: {other}"
                )));
            }
            None => {
                return Err(SettingsError::Invalid(
                    "Command run mode must be a string.".to_string(),
                ));
            }
        };

        if !seen.insert(id.clone()) {
            return Err(SettingsError::Invalid(format!(
                "Duplicate command id: {id}"
            )));
        }

        commands.push(QuickCommand {
            id,
            label,
            command,
            run_mode,
        });
    }

    Ok(commands)
}

fn normalize_shortcuts(
    value: Option<&Value>,
    command_ids: &HashSet<String>,
) -> Result<HashMap<String, ShortcutBinding>, SettingsError> {
    let object = value.and_then(Value::as_object).ok_or_else(|| {
        SettingsError::Invalid("Settings shortcuts must be an object.".to_string())
    })?;

    let mut shortcuts = default_settings().shortcuts;

    for (action_id, raw_binding) in object {
        if let Some(command_id) = action_id.strip_prefix("runCommand:")
            && !command_ids.contains(command_id)
        {
            continue;
        }

        shortcuts.insert(action_id.clone(), normalize_shortcut_binding(raw_binding)?);
    }

    Ok(shortcuts)
}

fn normalize_shortcut_binding(value: &Value) -> Result<ShortcutBinding, SettingsError> {
    let object = value
        .as_object()
        .ok_or_else(|| SettingsError::Invalid("Shortcut binding must be an object.".to_string()))?;

    let accelerator = object
        .get("accelerator")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();

    let scope = match object.get("scope").and_then(Value::as_str) {
        Some("global") => ShortcutScope::Global,
        Some("app") => ShortcutScope::App,
        Some("disabled") => ShortcutScope::Disabled,
        Some(other) => {
            return Err(SettingsError::Invalid(format!(
                "Invalid shortcut scope: {other}"
            )));
        }
        None => {
            return Err(SettingsError::Invalid(
                "Shortcut scope must be a string.".to_string(),
            ));
        }
    };

    Ok(ShortcutBinding { accelerator, scope })
}

fn normalize_layout(value: Option<&Value>) -> LayoutSettings {
    let width = value
        .and_then(Value::as_object)
        .and_then(|object| object.get("commandPanelWidth"))
        .and_then(Value::as_u64)
        .and_then(|number| u16::try_from(number).ok())
        .unwrap_or(DEFAULT_COMMAND_PANEL_WIDTH)
        .clamp(MIN_COMMAND_PANEL_WIDTH, MAX_COMMAND_PANEL_WIDTH);

    LayoutSettings {
        command_panel_width: width,
    }
}

fn normalize_appearance(value: Option<&Value>) -> AppearanceSettings {
    let object = value.and_then(Value::as_object);
    let font_family = object
        .and_then(|object| object.get("fontFamily"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| FONT_FAMILY_OPTIONS.contains(value))
        .map(ToString::to_string)
        .unwrap_or_else(|| DEFAULT_FONT_FAMILY.to_string());
    let font_size = object
        .and_then(|object| object.get("fontSize"))
        .and_then(Value::as_u64)
        .and_then(|number| u16::try_from(number).ok())
        .unwrap_or(DEFAULT_FONT_SIZE)
        .clamp(MIN_FONT_SIZE, MAX_FONT_SIZE);
    let letter_spacing = object
        .and_then(|object| object.get("letterSpacing"))
        .and_then(Value::as_f64)
        .unwrap_or(DEFAULT_LETTER_SPACING)
        .clamp(MIN_LETTER_SPACING, MAX_LETTER_SPACING);
    let line_height = object
        .and_then(|object| object.get("lineHeight"))
        .and_then(Value::as_f64)
        .unwrap_or(DEFAULT_LINE_HEIGHT)
        .clamp(MIN_LINE_HEIGHT, MAX_LINE_HEIGHT);
    let cursor_style = match object
        .and_then(|object| object.get("cursorStyle"))
        .and_then(Value::as_str)
    {
        Some("bar") => CursorStyle::Bar,
        Some("underline") => CursorStyle::Underline,
        _ => CursorStyle::Block,
    };

    AppearanceSettings {
        font_family,
        font_size,
        letter_spacing,
        line_height,
        cursor_style,
    }
}

fn normalize_features(value: Option<&Value>) -> FeatureSettings {
    let object = value.and_then(Value::as_object);
    let command_history = object
        .and_then(|object| object.get("commandHistory"))
        .and_then(Value::as_object);
    let autosuggestions = object
        .and_then(|object| object.get("autosuggestions"))
        .and_then(Value::as_object);

    let max_entries = command_history
        .and_then(|object| object.get("maxEntries"))
        .and_then(Value::as_u64)
        .and_then(|number| usize::try_from(number).ok())
        .unwrap_or(DEFAULT_COMMAND_HISTORY_MAX_ENTRIES)
        .clamp(
            MIN_COMMAND_HISTORY_MAX_ENTRIES,
            MAX_COMMAND_HISTORY_MAX_ENTRIES,
        );

    FeatureSettings {
        command_history: CommandHistorySettings {
            enabled: command_history
                .and_then(|object| object.get("enabled"))
                .and_then(Value::as_bool)
                .unwrap_or(true),
            max_entries,
        },
        autosuggestions: AutosuggestionSettings {
            enabled: autosuggestions
                .and_then(|object| object.get("enabled"))
                .and_then(Value::as_bool)
                .unwrap_or(true),
            accept_with_tab: autosuggestions
                .and_then(|object| object.get("acceptWithTab"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
        },
    }
}

fn read_required_string(value: Option<&Value>, label: &str) -> Result<String, SettingsError> {
    match value.and_then(Value::as_str).map(str::trim) {
        Some(value) if !value.is_empty() => Ok(value.to_string()),
        _ => Err(SettingsError::Invalid(format!(
            "{label} must be a non-empty string."
        ))),
    }
}

fn default_settings() -> AppSettings {
    let commands = vec![
        QuickCommand {
            id: "cmd_git_status".to_string(),
            label: "git status".to_string(),
            command: "git status".to_string(),
            run_mode: QuickCommandRunMode::Send,
        },
        QuickCommand {
            id: "cmd_pnpm_dev".to_string(),
            label: "pnpm dev".to_string(),
            command: "pnpm dev".to_string(),
            run_mode: QuickCommandRunMode::Send,
        },
        QuickCommand {
            id: "cmd_clear".to_string(),
            label: "clear".to_string(),
            command: "clear".to_string(),
            run_mode: QuickCommandRunMode::Send,
        },
    ];

    let mut shortcuts = HashMap::new();
    insert_shortcut(
        &mut shortcuts,
        "toggleVisibility",
        TOGGLE_SHORTCUT,
        ShortcutScope::Global,
    );
    insert_shortcut(
        &mut shortcuts,
        "openSettings",
        "CmdOrCtrl+,",
        ShortcutScope::App,
    );
    insert_shortcut(&mut shortcuts, "newTab", "CmdOrCtrl+T", ShortcutScope::App);
    insert_shortcut(
        &mut shortcuts,
        "closeTab",
        "CmdOrCtrl+W",
        ShortcutScope::App,
    );
    insert_shortcut(
        &mut shortcuts,
        "nextTab",
        "CmdOrCtrl+Shift+]",
        ShortcutScope::App,
    );
    insert_shortcut(
        &mut shortcuts,
        "previousTab",
        "CmdOrCtrl+Shift+[",
        ShortcutScope::App,
    );
    for index in 1..=9 {
        insert_shortcut(
            &mut shortcuts,
            &format!("selectTab:{index}"),
            &format!("CmdOrCtrl+{index}"),
            ShortcutScope::App,
        );
    }

    AppSettings {
        language: AppLanguage::En,
        commands,
        shortcuts,
        layout: LayoutSettings {
            command_panel_width: DEFAULT_COMMAND_PANEL_WIDTH,
        },
        appearance: AppearanceSettings {
            font_family: DEFAULT_FONT_FAMILY.to_string(),
            font_size: DEFAULT_FONT_SIZE,
            letter_spacing: DEFAULT_LETTER_SPACING,
            line_height: DEFAULT_LINE_HEIGHT,
            cursor_style: CursorStyle::Block,
        },
        features: FeatureSettings {
            command_history: CommandHistorySettings {
                enabled: true,
                max_entries: DEFAULT_COMMAND_HISTORY_MAX_ENTRIES,
            },
            autosuggestions: AutosuggestionSettings {
                enabled: true,
                accept_with_tab: false,
            },
        },
    }
}

fn insert_shortcut(
    shortcuts: &mut HashMap<String, ShortcutBinding>,
    action_id: &str,
    accelerator: &str,
    scope: ShortcutScope,
) {
    shortcuts.insert(
        action_id.to_string(),
        ShortcutBinding {
            accelerator: accelerator.to_string(),
            scope,
        },
    );
}

fn chrono_like_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    seconds.to_string()
}

#[allow(dead_code)]
pub fn default_shell() -> &'static str {
    DEFAULT_SHELL
}
