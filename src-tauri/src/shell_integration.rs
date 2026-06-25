use std::{fs, path::PathBuf};
use tauri::AppHandle;
use thiserror::Error;

const ZSH_INTEGRATION_RELATIVE_PATH: [&str; 2] = ["shell-integration", "zsh.zsh"];

const ZSH_INTEGRATION_SCRIPT: &str = r#"# FlickTerm zsh shell integration.
# This file is managed by FlickTerm. Source it from ~/.zshrc to let FlickTerm
# save the command that zsh is about to execute as command history.

if [[ ! -o interactive ]]; then
  return 0 2>/dev/null || exit 0
fi

_flickterm_percent_encode() {
  emulate -L zsh
  local input="$1"
  local output=""
  local char
  local index

  for (( index = 1; index <= ${#input}; index++ )); do
    char="${input[index]}"
    case "$char" in
      "%") output+="%25" ;;
      ";") output+="%3B" ;;
      "=") output+="%3D" ;;
      $'\a') output+="%07" ;;
      $'\e') output+="%1B" ;;
      $'\n') output+="%0A" ;;
      $'\r') output+="%0D" ;;
      $'\t') output+="%09" ;;
      *) output+="$char" ;;
    esac
  done

  print -rn -- "$output"
}

_flickterm_preexec() {
  emulate -L zsh
  local command="$1"
  local cwd="$PWD"

  if [[ -z "$command" ]]; then
    return 0
  fi

  printf '\e]7777;FlickTermExecutedCommand;command=%s;cwd=%s\a' \
    "$(_flickterm_percent_encode "$command")" \
    "$(_flickterm_percent_encode "$cwd")"
}

_flickterm_precmd() {
  emulate -L zsh
  printf '\e]7777;FlickTermShellIntegrationReady;cwd=%s\a' \
    "$(_flickterm_percent_encode "$PWD")"
}

autoload -Uz add-zsh-hook
add-zsh-hook -d preexec _flickterm_preexec 2>/dev/null
add-zsh-hook preexec _flickterm_preexec
add-zsh-hook -d precmd _flickterm_precmd 2>/dev/null
add-zsh-hook precmd _flickterm_precmd
_flickterm_precmd
"#;

#[derive(Debug, Error)]
pub enum ShellIntegrationError {
    #[error("Could not resolve the app configuration directory.")]
    ConfigDir,
    #[error("Could not resolve the home directory.")]
    HomeDir,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub fn ensure_shell_integration_files(app: &AppHandle) -> Result<(), ShellIntegrationError> {
    let path = zsh_integration_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, ZSH_INTEGRATION_SCRIPT)?;
    Ok(())
}

pub fn zshrc_snippet(app: &AppHandle) -> Result<String, ShellIntegrationError> {
    let path = zsh_integration_path(app)?;
    let display_path = path.to_string_lossy();
    Ok(format!(
        "# FlickTerm shell integration\n\
         # Sends the command that zsh is about to execute back to FlickTerm,\n\
         # so FlickTerm can save the actual executed command in its history.\n\
         # Remove these lines to disable FlickTerm command history integration.\n\
         if [ -r \"{display_path}\" ]; then\n\
           source \"{display_path}\"\n\
         fi"
    ))
}

pub fn install_zshrc_snippet(app: &AppHandle) -> Result<PathBuf, ShellIntegrationError> {
    ensure_shell_integration_files(app)?;
    let snippet = zshrc_snippet(app)?;
    let zshrc_path = dirs::home_dir()
        .ok_or(ShellIntegrationError::HomeDir)?
        .join(".zshrc");
    let existing = match fs::read_to_string(&zshrc_path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.into()),
    };

    if !existing.contains("FlickTerm shell integration")
        && !existing.contains(&zsh_integration_path(app)?.to_string_lossy().to_string())
    {
        let mut next = existing;
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        if !next.is_empty() {
            next.push('\n');
        }
        next.push_str(&snippet);
        next.push('\n');
        fs::write(&zshrc_path, next)?;
    }

    Ok(zshrc_path)
}

fn zsh_integration_path(app: &AppHandle) -> Result<PathBuf, ShellIntegrationError> {
    let mut path = dirs::config_dir()
        .ok_or(ShellIntegrationError::ConfigDir)?
        .join(app.config().product_name.as_deref().unwrap_or("FlickTerm"));
    for part in ZSH_INTEGRATION_RELATIVE_PATH {
        path.push(part);
    }
    Ok(path)
}
