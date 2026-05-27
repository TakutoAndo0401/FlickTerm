---
name: lightweight-ui-implementation
description: Use when implementing FlickTerm's renderer UI with a lightweight, desktop-app-oriented interface, including layout, state, keyboard interactions, responsive panes, and minimal dependencies.
---

# Lightweight UI Implementation

Use this skill for FlickTerm renderer UI, component structure, visual polish, keyboard ergonomics, and desktop utility workflows.

## Workflow

1. Inspect the current renderer stack and styling approach before adding dependencies.
2. Keep the first screen an actual usable terminal interface, not a landing page.
3. Prefer dense, predictable desktop UI: toolbar, tabs/sessions, terminal surface, status area, settings panels only when needed.
4. Use native-feeling controls and keyboard-first flows. Provide mouse controls without making them the only path.
5. Keep visual treatment restrained: stable spacing, clear focus states, readable contrast, and no decorative backgrounds that compete with terminal content.
6. Avoid large UI libraries unless they remove real complexity. Prefer plain CSS, CSS modules, or the repo's existing styling system.

## Implementation Notes

- Terminal content gets priority in the layout. Controls should not resize or overlap the terminal surface.
- Use icons for compact actions when an icon library is already present; otherwise keep text labels short and stable.
- Make panes and tabs resilient to narrow windows with explicit min sizes and overflow behavior.
- Store UI-only state in the renderer. Persist settings through a typed preload API when needed.

## Validation

- Verify desktop and small-window layouts.
- Check keyboard focus order and common shortcuts.
- Start the app or renderer dev server after significant UI changes and visually inspect the result.
