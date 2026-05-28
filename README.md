# FlickTerm

A small Rust/Tauri terminal app built with TypeScript, xterm.js, and portable-pty.

## Requirements

- Node.js
- pnpm
- Rust
- macOS development tools, such as Xcode Command Line Tools
- mise is recommended for installing the pinned Node.js, pnpm, and Rust versions.

## Install

```sh
mise install
pnpm install
```

## Development

```sh
mise install
pnpm dev
```

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

Pushing a version tag can be used by release automation to publish macOS artifacts.

## Notes

- Tauri uses Rust for the desktop backend and the system WebView for rendering.
- The terminal PTY is handled by Rust through portable-pty.
- macOS DMG packaging is intentionally not enabled in the default build target; the verified default artifact is the `.app` bundle.

## Structure

- `src-tauri`: Rust/Tauri app lifecycle, commands, settings, global shortcut plugin setup, and PTY process management.
- `src/renderer`: Plain HTML/CSS/TypeScript UI, xterm.js rendering, tabs, and quick commands.
- `src/shared`: Shared TypeScript types for terminal tabs, IPC payloads, and commands.
