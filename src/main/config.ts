import type { QuickCommand } from "../shared/terminalTypes";

export const appConfig = {
  defaultShell: "/bin/zsh",
  toggleShortcut: "Alt+Space",
  initialCols: 80,
  initialRows: 24
} as const;

export const quickCommands: QuickCommand[] = [
  {
    label: "git status",
    command: "git status"
  },
  {
    label: "pnpm dev",
    command: "pnpm dev"
  },
  {
    label: "clear",
    command: "clear"
  }
];
