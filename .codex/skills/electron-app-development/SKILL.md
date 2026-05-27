---
name: electron-app-development
description: Use when building, reviewing, or changing FlickTerm as an Electron desktop app, including main/preload/renderer boundaries, app lifecycle, packaging, IPC, security, and local verification.
---

# Electron App Development

Use this skill for FlickTerm work that touches Electron structure, desktop app behavior, IPC, windows, menus, packaging, or runtime integration.

## Workflow

1. Inspect the existing project structure before choosing patterns. Identify main process, preload scripts, renderer entrypoints, build tooling, and package scripts.
2. Keep responsibilities separated:
   - Main process: app lifecycle, BrowserWindow creation, native OS integration, child processes, filesystem, and privileged APIs.
   - Preload: narrow, typed bridge using `contextBridge`.
   - Renderer: UI state and user interactions only.
3. Prefer `contextIsolation: true`, `nodeIntegration: false`, explicit preload APIs, and typed IPC request/response contracts.
4. Avoid exposing raw `ipcRenderer`, shell, filesystem, or process APIs to the renderer.
5. For new desktop capabilities, define the smallest IPC surface first, then implement main-process behavior behind it.
6. Verify behavior through the repo's scripts. If no scripts exist yet, add focused setup scripts rather than relying on ad hoc commands.

## Implementation Notes

- Use TypeScript types shared between preload and renderer for IPC payloads.
- Handle app lifecycle across macOS and Windows where relevant: `ready`, `window-all-closed`, `activate`, graceful teardown.
- Keep development and production paths explicit. Avoid assumptions about `process.cwd()` once packaged.
- When introducing Electron Forge, Builder, Vite, or similar tooling, align all scripts and path aliases in one pass.

## Validation

- Run typecheck and lint when available.
- Start the Electron app locally after UI or lifecycle changes.
- For packaging-related changes, run the lightest package/build command available and report anything skipped.
