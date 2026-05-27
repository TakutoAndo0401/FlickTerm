---
name: typescript-project-setup
description: Use when setting up or changing FlickTerm's TypeScript configuration, package scripts, project references, module resolution, strictness, build tooling, and typed Electron boundaries.
---

# TypeScript Project Setup

Use this skill for TypeScript configuration, build scripts, aliases, project layout, generated types, or compiler strictness decisions.

## Workflow

1. Inspect `package.json`, `tsconfig*`, build tool config, and source layout before editing.
2. Prefer a small number of explicit TypeScript projects:
   - main process config
   - preload config
   - renderer config
   - shared types config when needed
3. Keep module formats compatible with the chosen Electron and bundler setup. Do not mix ESM/CJS casually.
4. Turn on strictness early for app code: `strict`, `noImplicitOverride`, `noUncheckedIndexedAccess` where practical.
5. Use path aliases only when the bundler, test runner, and TypeScript all resolve them consistently.
6. Add scripts for the expected workflow: `dev`, `typecheck`, `lint`, `build`, and focused test commands as the project grows.

## Implementation Notes

- Keep shared IPC and domain types in a neutral module that both preload and renderer can import safely.
- Avoid importing Electron or Node-only modules from renderer code unless the build boundary explicitly supports it.
- For Vite-based renderer code, keep DOM and Node type libraries separated between configs.

## Validation

- Run `tsc --noEmit` or the repo's typecheck script.
- Run the app or build command after changing module resolution, aliases, or output directories.
- Report any missing scripts and add them when setup work requires repeatable verification.
