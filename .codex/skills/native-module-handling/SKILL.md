---
name: native-module-handling
description: Use when adding, updating, debugging, or packaging native Node modules in FlickTerm, especially PTY modules, Electron ABI rebuilds, prebuilds, notarization-sensitive files, and cross-platform install behavior.
---

# Native Module Handling

Use this skill for native dependencies such as PTY bindings, Electron rebuild issues, platform-specific binaries, packaging failures, and install/runtime mismatches.

## Workflow

1. Identify the native module, Electron version, Node version, package manager, CPU architecture, and target platforms.
2. Prefer maintained packages with Electron-compatible prebuilds. For PTY support, validate the package's Electron support before integrating it.
3. Keep native modules out of renderer code. Load them from main-process code or a controlled service module.
4. Ensure install/build scripts include Electron ABI rebuild steps when required.
5. For packaged apps, verify native binaries are included in the final artifact and loaded from packaged paths.
6. Document platform-specific prerequisites only when the repo actually needs them.

## Implementation Notes

- Check Apple Silicon and Intel differences on macOS when native binaries are involved.
- Avoid broad postinstall scripts. Scope rebuild commands to the packages that need them.
- Keep optional native dependencies explicit when a feature can degrade gracefully.
- Do not silence native build errors unless the dependency is truly optional.

## Validation

- Run install/build/typecheck commands available in the repo.
- Start the Electron app and exercise the native feature, not just the import path.
- For packaging changes, run the lightest packaging verification available and report any platform not tested.
