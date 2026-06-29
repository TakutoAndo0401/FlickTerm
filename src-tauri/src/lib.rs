mod command_history;
mod settings;
mod shell_integration;
mod terminal;
mod terminal_sessions;
mod types;

use command_history::CommandHistoryStore;
use settings::{SettingsStore, default_shell};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, State};
use terminal::PtyManager;
use terminal_sessions::TerminalSessionsStore;
use types::{
    AppSettings, AppSettingsSnapshot, CommandHistoryEntry, CommandHistoryRecordRequest,
    CompletionItem, CompletionKind, CompletionRequest, CompletionSource, CreateTerminalRequest,
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

    let resolved_git_completion =
        if matches!(request.source, Some(CompletionSource::Filesystem) | None) {
            resolve_git_completion_from_context(&cwd, &request)
        } else {
            None
        };
    let completion_source = resolved_git_completion
        .as_ref()
        .map(|routing| &routing.source)
        .or(request.source.as_ref());
    let completion_remote = resolved_git_completion
        .as_ref()
        .and_then(|routing| routing.remote.as_deref())
        .or(request.remote.as_deref());

    match completion_source {
        Some(CompletionSource::GitLocalBranches) => {
            return list_git_ref_completions(&cwd, &request.token, &["refs/heads"]);
        }
        Some(CompletionSource::GitRemoteBranches) => {
            return list_git_remote_branch_completions(&cwd, &request.token, completion_remote);
        }
        Some(CompletionSource::GitRefs) => {
            return list_git_ref_completions(
                &cwd,
                &request.token,
                &["refs/heads", "refs/remotes", "refs/tags"],
            );
        }
        Some(CompletionSource::GitTags) => {
            return list_git_ref_completions(&cwd, &request.token, &["refs/tags"]);
        }
        Some(CompletionSource::GitRemotes) => {
            return list_git_remote_completions(&cwd, &request.token);
        }
        Some(CompletionSource::GitStashes) => {
            return list_git_stash_completions(&cwd, &request.token);
        }
        Some(CompletionSource::Filesystem) | None => {}
    }

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

    sort_completion_items(&mut items);
    items.truncate(MAX_COMPLETION_RESULTS);
    Ok(items)
}

struct GitCompletionRouting {
    source: CompletionSource,
    remote: Option<String>,
}

fn resolve_git_completion_from_context(
    cwd: &Path,
    request: &CompletionRequest,
) -> Option<GitCompletionRouting> {
    let command_prefix = request.command_prefix.as_deref()?.trim();
    if command_prefix.is_empty() {
        return None;
    }

    let mut words = split_shell_words(command_prefix);
    if words.is_empty() {
        return None;
    }

    if words.first().is_some_and(|word| word != "git") {
        let aliases = load_shell_aliases(request.shell.as_deref());
        words = expand_shell_alias(&words, &aliases)?;
    }

    words = strip_shell_command_wrappers(words);
    if words.first().is_some_and(|word| word != "git") {
        return None;
    }

    if words.len() >= 2 {
        let git_aliases = load_git_aliases(cwd);
        if let Some(expanded) = expand_git_alias(&words, &git_aliases) {
            words = expanded;
        }
    }

    route_git_completion_words(&words)
}

fn load_shell_aliases(shell: Option<&str>) -> HashMap<String, String> {
    let shell = shell
        .map(str::trim)
        .filter(|shell| !shell.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| default_shell().to_string());
    let shell_name = Path::new(&shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&shell);
    if !matches!(shell_name, "bash" | "zsh") {
        return HashMap::new();
    }

    let mut aliases = load_shell_aliases_from_startup_files(shell_name);
    let mut command = Command::new(&shell);
    command.args(["-ic", "alias"]).env("TERM", "dumb");
    if let Some(output) = run_command_stdout(&mut command, Duration::from_millis(700)) {
        aliases.extend(output.lines().filter_map(parse_alias_output_line));
    }

    aliases
}

fn load_shell_aliases_from_startup_files(shell_name: &str) -> HashMap<String, String> {
    let Some(home) = dirs::home_dir() else {
        return HashMap::new();
    };
    let files = match shell_name {
        "zsh" => [".zshrc", ".zprofile", ".zshenv"].as_slice(),
        "bash" => [".bashrc", ".bash_profile", ".profile"].as_slice(),
        _ => &[],
    };

    let mut aliases = HashMap::new();
    for file in files {
        let path = home.join(file);
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        aliases.extend(parse_alias_lines(&content));
    }
    aliases
}

fn parse_alias_lines(content: &str) -> HashMap<String, String> {
    content
        .lines()
        .filter_map(parse_alias_declaration_line)
        .collect()
}

fn parse_alias_declaration_line(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let line = line.strip_prefix("alias ")?;
    parse_alias_assignment(line)
}

fn parse_alias_output_line(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let line = line.strip_prefix("alias ").unwrap_or(line);
    parse_alias_assignment(line)
}

fn parse_alias_assignment(line: &str) -> Option<(String, String)> {
    let (name, value) = line.split_once('=')?;
    let name = name.trim();
    if name.is_empty() || name.chars().any(char::is_whitespace) {
        return None;
    }
    Some((name.to_string(), unquote_alias_value(value.trim())))
}

fn unquote_alias_value(value: &str) -> String {
    if value.len() >= 2 {
        let first = value.as_bytes()[0] as char;
        let last = value.as_bytes()[value.len() - 1] as char;
        if (first == '\'' && last == '\'') || (first == '"' && last == '"') {
            return value[1..value.len() - 1].replace("'\\''", "'");
        }
    }
    value.to_string()
}

fn expand_shell_alias(words: &[String], aliases: &HashMap<String, String>) -> Option<Vec<String>> {
    let alias = aliases.get(words.first()?)?;
    let mut expanded = split_shell_words(alias);
    if expanded.is_empty() {
        return None;
    }
    expanded.extend(words.iter().skip(1).cloned());
    Some(expanded)
}

fn load_git_aliases(cwd: &Path) -> HashMap<String, String> {
    let Some(lines) = run_git_lines(cwd, &["config", "--get-regexp", "^alias\\."]) else {
        return HashMap::new();
    };
    lines
        .into_iter()
        .filter_map(|line| {
            let (key, value) = line.split_once(char::is_whitespace)?;
            let name = key.strip_prefix("alias.")?;
            if name.is_empty() || value.starts_with('!') {
                return None;
            }
            Some((name.to_string(), value.trim().to_string()))
        })
        .collect()
}

fn expand_git_alias(words: &[String], aliases: &HashMap<String, String>) -> Option<Vec<String>> {
    if words.first()? != "git" {
        return None;
    }
    let alias = aliases.get(words.get(1)?)?;
    let mut expanded = vec!["git".to_string()];
    expanded.extend(split_shell_words(alias));
    if expanded.len() <= 1 {
        return None;
    }
    expanded.extend(words.iter().skip(2).cloned());
    Some(expanded)
}

fn strip_shell_command_wrappers(mut words: Vec<String>) -> Vec<String> {
    while matches!(
        words.first().map(String::as_str),
        Some("command" | "noglob")
    ) {
        words.remove(0);
    }
    words
}

fn route_git_completion_words(words: &[String]) -> Option<GitCompletionRouting> {
    if words.first()? != "git" {
        return None;
    }
    let subcommand = words.get(1)?.as_str();
    let args = &words[2..];
    let positional_args = git_positional_args(args);

    if matches!(subcommand, "checkout" | "switch")
        && positional_args.is_empty()
        && !args.iter().any(|arg| arg == "--")
    {
        return Some(git_completion(CompletionSource::GitLocalBranches));
    }

    if subcommand == "branch" && args.iter().any(|arg| is_git_delete_option(arg)) {
        return Some(git_completion(CompletionSource::GitLocalBranches));
    }

    if matches!(
        subcommand,
        "merge" | "rebase" | "cherry-pick" | "reset" | "log" | "show" | "diff"
    ) && positional_args.is_empty()
    {
        return Some(git_completion(CompletionSource::GitRefs));
    }

    if subcommand == "tag" && args.iter().any(|arg| is_git_delete_option(arg)) {
        return Some(git_completion(CompletionSource::GitTags));
    }

    if subcommand == "remote" && should_complete_git_remote(args, &positional_args) {
        return Some(git_completion(CompletionSource::GitRemotes));
    }

    if subcommand == "stash" && should_complete_git_stash(args, &positional_args) {
        return Some(git_completion(CompletionSource::GitStashes));
    }

    if matches!(subcommand, "fetch" | "pull") && positional_args.is_empty() {
        return Some(git_completion(CompletionSource::GitRemotes));
    }

    if matches!(subcommand, "fetch" | "pull") && positional_args.len() == 1 {
        return Some(git_remote_branch_completion(&positional_args[0]));
    }

    if subcommand == "push" && positional_args.is_empty() {
        return Some(git_completion(CompletionSource::GitRemotes));
    }

    if subcommand == "push" && positional_args.len() == 1 {
        return if args.iter().any(|arg| is_git_delete_option(arg)) {
            Some(git_remote_branch_completion(&positional_args[0]))
        } else {
            Some(git_completion(CompletionSource::GitLocalBranches))
        };
    }

    None
}

fn git_completion(source: CompletionSource) -> GitCompletionRouting {
    GitCompletionRouting {
        source,
        remote: None,
    }
}

fn git_remote_branch_completion(remote: &str) -> GitCompletionRouting {
    GitCompletionRouting {
        source: CompletionSource::GitRemoteBranches,
        remote: Some(remote.to_string()),
    }
}

fn git_positional_args(args: &[String]) -> Vec<String> {
    args.iter()
        .filter(|arg| !arg.starts_with('-'))
        .cloned()
        .collect()
}

fn is_git_delete_option(arg: &str) -> bool {
    matches!(arg, "-d" | "-D" | "--delete")
}

fn should_complete_git_remote(args: &[String], positional_args: &[String]) -> bool {
    let Some(action) = args.first().map(String::as_str) else {
        return false;
    };
    positional_args.len() == 1
        && matches!(
            action,
            "get-url" | "prune" | "remove" | "rename" | "rm" | "set-head" | "set-url" | "show"
        )
}

fn should_complete_git_stash(args: &[String], positional_args: &[String]) -> bool {
    let Some(action) = args.first().map(String::as_str) else {
        return false;
    };
    match action {
        "branch" => positional_args.len() >= 2,
        "apply" | "drop" | "pop" | "show" => positional_args.len() == 1,
        _ => false,
    }
}

fn split_shell_words(value: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escaped = false;

    for char in value.chars() {
        if escaped {
            current.push(char);
            escaped = false;
            continue;
        }
        if char == '\\' {
            escaped = true;
            continue;
        }
        if let Some(quote_char) = quote {
            if char == quote_char {
                quote = None;
            } else {
                current.push(char);
            }
            continue;
        }
        if char == '\'' || char == '"' {
            quote = Some(char);
            continue;
        }
        if char.is_whitespace() {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(char);
    }

    if escaped {
        current.push('\\');
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

fn list_git_ref_completions(
    cwd: &Path,
    token: &str,
    refs: &[&str],
) -> Result<Vec<CompletionItem>, String> {
    let prefix = unescape_shell_token(token);
    let mut args = vec!["for-each-ref", "--format=%(refname)"];
    args.extend_from_slice(refs);
    let lines = match run_git_lines(cwd, &args) {
        Some(lines) => lines,
        None => return Ok(Vec::new()),
    };

    let mut items = lines
        .into_iter()
        .filter_map(|refname| {
            let (name, item_kind) = if let Some(name) = refname.strip_prefix("refs/heads/") {
                (name.to_string(), CompletionKind::Branch)
            } else if let Some(name) = refname.strip_prefix("refs/remotes/") {
                (name.to_string(), CompletionKind::Branch)
            } else if let Some(name) = refname.strip_prefix("refs/tags/") {
                (name.to_string(), CompletionKind::Tag)
            } else {
                return None;
            };
            if name.is_empty() || name.ends_with("/HEAD") || !name.starts_with(&prefix) {
                return None;
            }
            Some(CompletionItem {
                insert_text: shell_escape_path_component(&name),
                display: name.clone(),
                name,
                kind: item_kind,
            })
        })
        .collect::<Vec<_>>();

    sort_completion_items(&mut items);
    items.truncate(MAX_COMPLETION_RESULTS);
    Ok(items)
}

fn list_git_remote_branch_completions(
    cwd: &Path,
    token: &str,
    remote: Option<&str>,
) -> Result<Vec<CompletionItem>, String> {
    let prefix = unescape_shell_token(token);
    let lines = match run_git_lines(
        cwd,
        &["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
    ) {
        Some(lines) => lines,
        None => return Ok(Vec::new()),
    };
    let remote_prefix = remote
        .filter(|remote| !remote.is_empty())
        .map(|remote| format!("{remote}/"));

    let mut items = lines
        .into_iter()
        .filter(|name| !name.is_empty() && !name.ends_with("/HEAD"))
        .filter_map(|name| {
            let display_name = match &remote_prefix {
                Some(prefix) => name.strip_prefix(prefix).map(str::to_string)?,
                None => name,
            };
            if !display_name.starts_with(&prefix) {
                return None;
            }
            Some(CompletionItem {
                insert_text: shell_escape_path_component(&display_name),
                display: display_name.clone(),
                name: display_name,
                kind: CompletionKind::Branch,
            })
        })
        .collect::<Vec<_>>();

    sort_completion_items(&mut items);
    items.truncate(MAX_COMPLETION_RESULTS);
    Ok(items)
}

fn list_git_remote_completions(cwd: &Path, token: &str) -> Result<Vec<CompletionItem>, String> {
    let prefix = unescape_shell_token(token);
    let lines = match run_git_lines(cwd, &["remote"]) {
        Some(lines) => lines,
        None => return Ok(Vec::new()),
    };

    let mut items = lines
        .into_iter()
        .filter(|name| !name.is_empty() && name.starts_with(&prefix))
        .map(|name| CompletionItem {
            insert_text: shell_escape_path_component(&name),
            display: name.clone(),
            name,
            kind: CompletionKind::Remote,
        })
        .collect::<Vec<_>>();

    sort_completion_items(&mut items);
    items.truncate(MAX_COMPLETION_RESULTS);
    Ok(items)
}

fn list_git_stash_completions(cwd: &Path, token: &str) -> Result<Vec<CompletionItem>, String> {
    let prefix = unescape_shell_token(token);
    let lines = match run_git_lines(cwd, &["stash", "list", "--format=%gd%x00%gs"]) {
        Some(lines) => lines,
        None => return Ok(Vec::new()),
    };

    let mut items = lines
        .into_iter()
        .filter_map(|line| {
            let (name, subject) = line.split_once('\0').unwrap_or((&line, ""));
            if name.is_empty() || !name.starts_with(&prefix) {
                return None;
            }
            let display = if subject.is_empty() {
                name.to_string()
            } else {
                format!("{name} {subject}")
            };
            Some(CompletionItem {
                insert_text: shell_escape_path_component(name),
                display,
                name: name.to_string(),
                kind: CompletionKind::Stash,
            })
        })
        .collect::<Vec<_>>();

    sort_completion_items(&mut items);
    items.truncate(MAX_COMPLETION_RESULTS);
    Ok(items)
}

fn run_git_lines(cwd: &Path, args: &[&str]) -> Option<Vec<String>> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::to_string)
            .collect(),
    )
}

fn run_command_stdout(command: &mut Command, timeout: Duration) -> Option<String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().ok()? {
            break status;
        }
        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(Duration::from_millis(10));
    };

    let mut output = String::new();
    stdout.read_to_string(&mut output).ok()?;
    if status.success() { Some(output) } else { None }
}

fn sort_completion_items(items: &mut [CompletionItem]) {
    items.sort_by(|left, right| {
        completion_kind_rank(&left.kind)
            .cmp(&completion_kind_rank(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
}

fn completion_kind_rank(kind: &CompletionKind) -> u8 {
    match kind {
        CompletionKind::Directory => 0,
        CompletionKind::File => 1,
        CompletionKind::Branch => 2,
        CompletionKind::Tag => 3,
        CompletionKind::Remote => 4,
        CompletionKind::Stash => 5,
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_shell_alias_output() {
        assert_eq!(
            parse_alias_output_line("gc='git checkout'"),
            Some(("gc".to_string(), "git checkout".to_string()))
        );
        assert_eq!(
            parse_alias_output_line("alias gb='git branch'"),
            Some(("gb".to_string(), "git branch".to_string()))
        );
        assert_eq!(
            parse_alias_declaration_line("alias gp='git pull'"),
            Some(("gp".to_string(), "git pull".to_string()))
        );
    }

    #[test]
    fn parses_aliases_from_startup_file_content() {
        let aliases = parse_alias_lines(
            r#"
            # comment
            export EDITOR=vim
            alias gb='git branch'
            alias gc="git checkout"
            "#,
        );

        assert_eq!(aliases.get("gb").map(String::as_str), Some("git branch"));
        assert_eq!(aliases.get("gc").map(String::as_str), Some("git checkout"));
        assert!(!aliases.contains_key("EDITOR"));
    }

    #[test]
    fn routes_shell_alias_branch_delete_to_local_branches() {
        let mut aliases = HashMap::new();
        aliases.insert("gb".to_string(), "git branch".to_string());
        let expanded =
            expand_shell_alias(&split_shell_words("gb -D"), &aliases).expect("alias expands");
        let routing = route_git_completion_words(&expanded).expect("git route exists");

        assert!(matches!(routing.source, CompletionSource::GitLocalBranches));
        assert_eq!(routing.remote, None);
    }

    #[test]
    fn routes_git_alias_checkout_to_local_branches() {
        let mut aliases = HashMap::new();
        aliases.insert("co".to_string(), "checkout".to_string());
        let expanded =
            expand_git_alias(&split_shell_words("git co"), &aliases).expect("alias expands");
        let routing = route_git_completion_words(&expanded).expect("git route exists");

        assert!(matches!(routing.source, CompletionSource::GitLocalBranches));
    }

    #[test]
    fn routes_git_push_delete_remote_branch() {
        let routing = route_git_completion_words(&split_shell_words("git push --delete origin"))
            .expect("git route exists");

        assert!(matches!(
            routing.source,
            CompletionSource::GitRemoteBranches
        ));
        assert_eq!(routing.remote.as_deref(), Some("origin"));
    }
}
