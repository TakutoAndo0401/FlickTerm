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

```sh
git tag v0.1.0
git push origin v0.1.0
```

Keep `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` versions aligned with the tag. Pushing a version tag publishes macOS artifacts to GitHub Releases.

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
