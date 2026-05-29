use crate::types::{CommandHistoryEntry, CommandHistoryRecordRequest};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::AppHandle;
use thiserror::Error;

const HISTORY_FILE_NAME: &str = "command-history.json";
const HISTORY_VERSION: u8 = 1;

#[derive(Debug, Error)]
pub enum CommandHistoryError {
    #[error("Could not resolve the app configuration directory.")]
    ConfigDir,
    #[error("Command history lock was poisoned.")]
    Lock,
    #[error("Invalid command history: {0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandHistoryFile {
    version: u8,
    entries: Vec<CommandHistoryEntry>,
}

pub struct CommandHistoryStore {
    path: PathBuf,
    entries: Mutex<Vec<CommandHistoryEntry>>,
}

impl CommandHistoryStore {
    pub fn new(app: AppHandle) -> Result<Self, CommandHistoryError> {
        let config_dir = dirs::config_dir()
            .ok_or(CommandHistoryError::ConfigDir)?
            .join(app.config().product_name.as_deref().unwrap_or("FlickTerm"));

        Ok(Self {
            path: config_dir.join(HISTORY_FILE_NAME),
            entries: Mutex::new(Vec::new()),
        })
    }

    pub fn load(&self) -> Result<(), CommandHistoryError> {
        let entries = self.read_from_disk().unwrap_or_default();
        let mut state = self.entries.lock().map_err(|_| CommandHistoryError::Lock)?;
        *state = entries;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<CommandHistoryEntry>, CommandHistoryError> {
        self.entries
            .lock()
            .map(|entries| entries.clone())
            .map_err(|_| CommandHistoryError::Lock)
    }

    pub fn record(
        &self,
        request: CommandHistoryRecordRequest,
    ) -> Result<Vec<CommandHistoryEntry>, CommandHistoryError> {
        let command = request.command.trim().to_string();
        if command.is_empty() {
            return self.list();
        }

        let cwd = request.cwd.filter(|value| !value.trim().is_empty());
        let now = unix_timestamp_millis().to_string();
        let max_entries = request.max_entries.max(1);
        let snapshot = {
            let mut entries = self.entries.lock().map_err(|_| CommandHistoryError::Lock)?;
            if let Some(entry) = entries
                .iter_mut()
                .find(|entry| entry.command == command && entry.cwd == cwd)
            {
                entry.run_count = entry.run_count.saturating_add(1);
                entry.last_run_at = now;
                entry.last_exit_code = None;
                entry.last_duration_ms = None;
            } else {
                entries.push(CommandHistoryEntry {
                    command,
                    cwd,
                    run_count: 1,
                    first_run_at: now.clone(),
                    last_run_at: now,
                    last_exit_code: None,
                    last_duration_ms: None,
                });
            }

            prune_entries(&mut entries, max_entries);
            entries.clone()
        };

        self.persist(&snapshot)?;
        Ok(snapshot)
    }

    pub fn clear(&self) -> Result<Vec<CommandHistoryEntry>, CommandHistoryError> {
        {
            let mut entries = self.entries.lock().map_err(|_| CommandHistoryError::Lock)?;
            entries.clear();
        }
        self.persist(&[])?;
        Ok(Vec::new())
    }

    fn read_from_disk(&self) -> Result<Vec<CommandHistoryEntry>, CommandHistoryError> {
        match fs::read_to_string(&self.path) {
            Ok(raw) => {
                let file = serde_json::from_str::<CommandHistoryFile>(&raw)?;
                if file.version != HISTORY_VERSION {
                    return Err(CommandHistoryError::Invalid(format!(
                        "unsupported command history version {}",
                        file.version
                    )));
                }
                Ok(file.entries)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error.into()),
        }
    }

    fn persist(&self, entries: &[CommandHistoryEntry]) -> Result<(), CommandHistoryError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        let file = CommandHistoryFile {
            version: HISTORY_VERSION,
            entries: entries.to_vec(),
        };
        fs::write(
            &self.path,
            format!("{}\n", serde_json::to_string_pretty(&file)?),
        )?;
        Ok(())
    }
}

fn prune_entries(entries: &mut Vec<CommandHistoryEntry>, max_entries: usize) {
    if entries.len() <= max_entries {
        return;
    }

    entries.sort_by(|left, right| right.last_run_at.cmp(&left.last_run_at));
    entries.truncate(max_entries);
}

fn unix_timestamp_millis() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prunes_oldest_entries_by_last_run_time() {
        let mut entries = vec![
            entry("first", "1"),
            entry("second", "3"),
            entry("third", "2"),
        ];

        prune_entries(&mut entries, 2);

        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.command.as_str())
                .collect::<Vec<_>>(),
            vec!["second", "third"]
        );
    }

    fn entry(command: &str, last_run_at: &str) -> CommandHistoryEntry {
        CommandHistoryEntry {
            command: command.to_string(),
            cwd: None,
            run_count: 1,
            first_run_at: last_run_at.to_string(),
            last_run_at: last_run_at.to_string(),
            last_exit_code: None,
            last_duration_ms: None,
        }
    }
}
