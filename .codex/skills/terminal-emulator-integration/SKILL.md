---
name: terminal-emulator-integration
description: Use when integrating terminal emulator behavior in FlickTerm, including pseudo-terminal processes, xterm.js-style rendering, shell sessions, resizing, input/output streams, and terminal lifecycle.
---

# Terminal Emulator Integration

Use this skill for terminal session, PTY, shell, rendering, keyboard input, resize, scrollback, and process lifecycle work.

## Workflow

1. Locate the terminal stack first: renderer terminal component, preload bridge, main-process session manager, and native PTY dependency.
2. Treat the PTY as main-process or privileged code. The renderer should only send user intent and receive terminal output through a narrow bridge.
3. Keep session lifecycle explicit: create, attach, resize, write, clear, detach, kill, and cleanup on window close.
4. Preserve backpressure and ordering. Avoid buffering strategies that can reorder terminal output or drop escape sequences.
5. Use a mature terminal renderer such as `xterm.js` when available. Do not hand-roll ANSI parsing unless the project explicitly requires it.
6. Normalize platform shell defaults carefully:
   - macOS/Linux: respect `$SHELL` when safe.
   - Windows: handle PowerShell/CMD paths explicitly.

## Implementation Notes

- Debounce resize events, but always deliver the latest cols/rows.
- Keep terminal dimensions based on measured cell size, not guessed viewport pixels.
- Sanitize or constrain launch arguments if any user-configurable command can reach the PTY.
- Ensure session cleanup handles renderer reloads during development.

## Validation

- Run an interactive smoke test: launch terminal, type a command, resize the window, clear/close the session.
- Check for leaked PTY processes after window close.
- Run typecheck/lint when available.
