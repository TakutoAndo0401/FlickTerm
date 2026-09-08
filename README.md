# FlickTerm

A small Rust/Tauri terminal app built with TypeScript, xterm.js, and portable-pty.

## Requirements

- Node.js
- pnpm
- Rust
- macOS development tools, such as Xcode Command Line Tools
- mise is recommended for installing the pinned Node.js, pnpm, and Rust versions.

## Setup

```sh
make setup
```

`make setup` installs the pinned toolchain and project dependencies, then verifies
that the development environment is ready.

## Build

```sh
mise install
pnpm build
```

The macOS app bundle is written to `src-tauri/target/release/bundle/macos/`.

## Package for macOS App Bundle

```sh
mise install
pnpm install
pnpm build
```

Artifacts are written to `src-tauri/target/release/bundle/macos/`.

### Release a new version

Bump every version file at once, commit the bump, then tag that commit:

```sh
pnpm version:set 0.1.0
pnpm version:check 0.1.0
git commit -am "chore(release): v0.1.0"
git push origin main
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

`pnpm version:set` updates `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` together; `pnpm version:check` (with or without an expected version) verifies they agree. Pushing a version tag publishes macOS artifacts to GitHub Releases. The Release workflow fails early if the tag does not match the version files, because the in-app updater compares the bundled version with the released one.

## App Updates

FlickTerm uses the Tauri updater plugin with GitHub Releases. The app checks:

```txt
https://github.com/TakutoAndo0401/FlickTerm/releases/latest/download/latest.json
```

Create an updater signing key once, or keep using an existing release signing
key:

```sh
mise exec -- pnpm tauri signer generate --ci -p "" -w ~/.tauri/flickterm-updater.key
```

Add these GitHub Actions secrets before pushing a release tag:

- `TAURI_SIGNING_PRIVATE_KEY`: the contents of `~/.tauri/flickterm-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: leave unset when using an empty password

Signing keys are only required when building signed updater artifacts. Regular
setup and development checks do not need them.

For local signed release builds, store the same values in `.mise.local.toml`.
This file is git-ignored and should not be committed:

```toml
[env]
TAURI_SIGNING_PRIVATE_KEY = "..."
TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
```

The public key is stored in `src-tauri/tauri.conf.json`. If you generate a new private key, replace the `plugins.updater.pubkey` value with the generated `.pub` file contents. Keep the private key out of Git.

## Notes

- Tauri uses Rust for the desktop backend and the system WebView for rendering.
- The terminal PTY is handled by Rust through portable-pty.
- macOS DMG packaging is intentionally not enabled in the default build target; the verified default artifact is the `.app` bundle.

## Structure

- `src-tauri`: Rust/Tauri app lifecycle, commands, settings, global shortcut plugin setup, and PTY process management.
- `src/renderer`: Plain HTML/CSS/TypeScript UI, xterm.js rendering, tabs, and quick commands.
- `src/shared`: Shared TypeScript types for terminal tabs, IPC payloads, and commands.
- `scripts`: Release helpers (`release-version.mjs` for version bumps/checks, `create-updater-json.mjs` for the updater manifest).
- `.rulesync`: Source of truth for AI agent rules and skills (see below).

## AI Agent Rules and Skills

Rules and skills for AI coding agents are managed with [rulesync](https://github.com/dyoshikawa/rulesync). Edit only the files under `.rulesync/` and regenerate the tool-specific files:

```sh
pnpm rulesync        # regenerate
pnpm rulesync:check  # verify generated files are up to date
```

| Source | Generated for GitHub Copilot | Generated for Codex CLI |
| --- | --- | --- |
| `.rulesync/rules/*.md` | `.github/copilot-instructions.md` | `AGENTS.md` |
| `.rulesync/skills/*/SKILL.md` | `.github/skills/*/SKILL.md` | `.agents/skills/*/SKILL.md` |

The generated files are committed so that both tools work without running rulesync, but they must not be edited by hand. Targets and options live in `rulesync.jsonc`.
