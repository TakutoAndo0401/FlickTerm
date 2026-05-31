use crate::types::TerminalSessionsSnapshot;
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::AppHandle;
use thiserror::Error;

const SESSIONS_FILE_NAME: &str = "sessions.json";
const SESSIONS_VERSION: u8 = 1;

#[derive(Debug, Error)]
pub enum TerminalSessionsError {
    #[error("Could not resolve the app configuration directory.")]
    ConfigDir,
    #[error("Terminal sessions lock was poisoned.")]
    Lock,
    #[error("Invalid terminal sessions: {0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub struct TerminalSessionsStore {
    path: PathBuf,
    snapshot: Mutex<TerminalSessionsSnapshot>,
}

impl TerminalSessionsStore {
    pub fn new(app: AppHandle) -> Result<Self, TerminalSessionsError> {
        let config_dir = dirs::config_dir()
            .ok_or(TerminalSessionsError::ConfigDir)?
            .join(app.config().product_name.as_deref().unwrap_or("FlickTerm"));

        Ok(Self {
            path: config_dir.join(SESSIONS_FILE_NAME),
            snapshot: Mutex::new(TerminalSessionsSnapshot::default()),
        })
    }

    pub fn load(&self) -> Result<(), TerminalSessionsError> {
        let snapshot = self.read_from_disk().unwrap_or_default();
        let mut state = self
            .snapshot
            .lock()
            .map_err(|_| TerminalSessionsError::Lock)?;
        *state = snapshot;
        Ok(())
    }

    pub fn get(&self) -> Result<TerminalSessionsSnapshot, TerminalSessionsError> {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .map_err(|_| TerminalSessionsError::Lock)
    }

    pub fn save(
        &self,
        snapshot: TerminalSessionsSnapshot,
    ) -> Result<TerminalSessionsSnapshot, TerminalSessionsError> {
        let normalized = normalize_snapshot(snapshot)?;
        {
            let mut state = self
                .snapshot
                .lock()
                .map_err(|_| TerminalSessionsError::Lock)?;
            *state = normalized.clone();
        }
        self.persist(&normalized)?;
        Ok(normalized)
    }

    pub fn clear(&self) -> Result<TerminalSessionsSnapshot, TerminalSessionsError> {
        {
            let mut state = self
                .snapshot
                .lock()
                .map_err(|_| TerminalSessionsError::Lock)?;
            *state = TerminalSessionsSnapshot::default();
        }

        match fs::remove_file(&self.path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }

        Ok(TerminalSessionsSnapshot::default())
    }

    fn read_from_disk(&self) -> Result<TerminalSessionsSnapshot, TerminalSessionsError> {
        match fs::read_to_string(&self.path) {
            Ok(raw) => {
                let snapshot = serde_json::from_str::<TerminalSessionsSnapshot>(&raw)?;
                normalize_snapshot(snapshot)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(TerminalSessionsSnapshot::default())
            }
            Err(error) => Err(error.into()),
        }
    }

    fn persist(&self, snapshot: &TerminalSessionsSnapshot) -> Result<(), TerminalSessionsError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::write(
            &self.path,
            format!("{}\n", serde_json::to_string_pretty(snapshot)?),
        )?;
        Ok(())
    }
}

fn normalize_snapshot(
    mut snapshot: TerminalSessionsSnapshot,
) -> Result<TerminalSessionsSnapshot, TerminalSessionsError> {
    if snapshot.version != SESSIONS_VERSION {
        return Err(TerminalSessionsError::Invalid(format!(
            "unsupported terminal sessions version {}",
            snapshot.version
        )));
    }

    snapshot.tabs.retain(|tab| !tab.id.trim().is_empty());
    snapshot.closed_tabs.retain(|tab| !tab.id.trim().is_empty());
    if let Some(active_id) = snapshot.active_tab_id.as_deref()
        && !snapshot.tabs.iter().any(|tab| tab.id == active_id)
    {
        snapshot.active_tab_id = snapshot.tabs.first().map(|tab| tab.id.clone());
    }

    Ok(snapshot)
}
