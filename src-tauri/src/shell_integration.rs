use std::{fs, path::PathBuf};
use tauri::AppHandle;
use thiserror::Error;

const ZSH_INTEGRATION_RELATIVE_PATH: [&str; 2] = ["shell-integration", "zsh.zsh"];

const ZSH_INTEGRATION_SCRIPT: &str = r#"# FlickTerm zsh shell integration.
# This file is managed by FlickTerm. Source it from ~/.zshrc to let FlickTerm
# save executed commands and optionally use the FlickTerm prompt theme.

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
  local token="${FLICKTERM_SHELL_INTEGRATION_TOKEN:-}"

  if [[ "${FLICKTERM_PROMPT_THEME:-}" == "modern" && -n "${FLICKTERM_PROMPT_LAST_PROMPT:-}" && "$PROMPT" == "$FLICKTERM_PROMPT_LAST_PROMPT" ]]; then
    print -P -rn -- "%f%k"
  fi

  if [[ -z "$command" || -z "$token" ]]; then
    return 0
  fi

  printf '\e]7777;FlickTermExecutedCommand;token=%s;command=%s;cwd=%s\a' \
    "$(_flickterm_percent_encode "$token")" \
    "$(_flickterm_percent_encode "$command")" \
    "$(_flickterm_percent_encode "$cwd")"
}

_flickterm_prompt_escape() {
  emulate -L zsh
  local input="$1"
  input="${input//$'\n'/ }"
  input="${input//$'\r'/ }"
  input="${input//$'\t'/ }"
  input="${input//\%/%%}"
  print -rn -- "$input"
}

_flickterm_prompt_has_external_owner() {
  emulate -L zsh
  local hook

  for hook in "${precmd_functions[@]}"; do
    case "$hook" in
      _flickterm_precmd) ;;
      *starship*|*p10k*|*_p9k*|*powerlevel*|*spaceship*|*pure*) return 0 ;;
    esac
  done

  if (( ${+functions[starship_precmd]} || ${+functions[_p9k_precmd]} || ${+functions[prompt_pure_precmd]} || ${+functions[spaceship_prompt]} )); then
    return 0
  fi

  [[ -n "${STARSHIP_SESSION_KEY:-}" || -n "${POWERLEVEL9K_VERSION:-}" || -n "${POWERLEVEL10K_VERSION:-}" || -n "${SPACESHIP_VERSION:-}" || -n "${PURE_PROMPT_SYMBOL:-}" ]]
}

_flickterm_prompt_is_default_prompt() {
  emulate -L zsh
  local prompt_value="${PROMPT:-${PS1:-}}"

  case "$prompt_value" in
    ""|"%m%# "|"%n@%m %1~ %# "|"%n@%m %~ %# "|"%n@%m %c %# "|"%# "|"> ") return 0 ;;
  esac

  return 1
}

_flickterm_prompt_git_segment() {
  emulate -L zsh
  command git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0

  local branch
  branch="$(command git symbolic-ref --quiet --short HEAD 2>/dev/null)"
  if [[ -z "$branch" ]]; then
    branch="$(command git rev-parse --short HEAD 2>/dev/null)" || return 0
    branch="detached:$branch"
  fi

  local state=""
  if ! command git diff --quiet --ignore-submodules -- 2>/dev/null; then
    state="*"
  fi
  if ! command git diff --cached --quiet --ignore-submodules -- 2>/dev/null; then
    state="${state}+"
  fi

  branch="$(_flickterm_prompt_escape "$branch")"
  print -rn -- "  %F{244}git:%f%F{magenta}${branch}%f"
  if [[ -n "$state" ]]; then
    print -rn -- "%F{yellow}${state}%f"
  fi
}

_flickterm_update_prompt() {
  emulate -L zsh

  [[ "${FLICKTERM_PROMPT_THEME:-}" == "modern" ]] || return 0
  [[ -z "${FLICKTERM_DISABLE_PROMPT_THEME:-}" ]] || return 0

  if [[ -n "${RPROMPT:-}" || -n "${RPS1:-}" ]]; then
    return 0
  fi

  if [[ -n "${FLICKTERM_PROMPT_LAST_PROMPT:-}" ]]; then
    [[ "$PROMPT" == "$FLICKTERM_PROMPT_LAST_PROMPT" ]] || return 0
  else
    _flickterm_prompt_has_external_owner && return 0
    _flickterm_prompt_is_default_prompt || return 0
  fi

  local git_segment="$(_flickterm_prompt_git_segment)"
  local next_prompt="%F{244}%D{%H:%M}%f  %F{39}%~%f${git_segment}"$'\n'"%(?.%F{green}>.%F{red}>)%f %F{120}"

  PROMPT="$next_prompt"
  PS1="$next_prompt"
  FLICKTERM_PROMPT_LAST_PROMPT="$next_prompt"
}

_flickterm_precmd() {
  emulate -L zsh
  _flickterm_update_prompt

  local token="${FLICKTERM_SHELL_INTEGRATION_TOKEN:-}"

  if [[ -z "$token" ]]; then
    return 0
  fi

  printf '\e]7777;FlickTermShellIntegrationReady;token=%s;cwd=%s\a' \
    "$(_flickterm_percent_encode "$token")" \
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
         # Sends zsh context back to FlickTerm for command history and the optional prompt theme.\n\
         # Remove these lines to disable FlickTerm shell integration.\n\
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
