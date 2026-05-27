# Lightweight Terminal

A small Electron terminal app built with TypeScript, xterm.js, and node-pty.

## Requirements

- Node.js
- pnpm
- mise is recommended for installing the pinned Node.js and pnpm versions.

## Install

```sh
mise install
pnpm install
```

`pnpm install` runs `electron-rebuild` for node-pty automatically.

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

## Package for macOS

```sh
mise install
pnpm install
pnpm dist:mac
```

Artifacts are written to `release/`.

```sh
git tag v0.1.0
git push origin v0.1.0
```

Pushing a version tag publishes the macOS artifacts to GitHub Releases.

## Notes

- node-pty may require rebuild for Electron.
- If the terminal fails to spawn or does not accept input after dependency installation, run:

```sh
pnpm run rebuild
```

or:

```sh
pnpm exec electron-rebuild -f -w node-pty
```

- Default shell is zsh (`/bin/zsh`).
- Toggle shortcut is `Alt+Space` by default.
- The shortcut can conflict with the OS or window manager. Registration failure is logged and does not crash the app.
- Shell paths and native build prerequisites can differ between macOS, Linux, and Windows.
- The first version intentionally does not include a theme editor, settings screen, session restore, AI features, cloud sync, or plugins.

## Structure

- `src/main`: Electron app lifecycle, BrowserWindow, globalShortcut, IPC, and node-pty process management.
- `src/preload`: Safe context bridge for renderer IPC access.
- `src/renderer`: Plain HTML/CSS/TypeScript UI, xterm.js rendering, tabs, and quick commands.
- `src/shared`: Shared TypeScript types for terminal tabs, IPC payloads, and commands.
