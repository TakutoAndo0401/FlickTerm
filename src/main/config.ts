import type { AppSettings, QuickCommand } from "../shared/terminalTypes";

export const appConfig = {
  defaultShell: "/bin/zsh",
  toggleShortcut: "Alt+Space",
  initialCols: 80,
  initialRows: 24,
  defaultCommandPanelWidth: 168,
  minCommandPanelWidth: 120,
  maxCommandPanelWidth: 360
} as const;

export const defaultQuickCommands: QuickCommand[] = [
  {
    id: "cmd_git_status",
    label: "git status",
    command: "git status",
    runMode: "send"
  },
  {
    id: "cmd_pnpm_dev",
    label: "pnpm dev",
    command: "pnpm dev",
    runMode: "send"
  },
  {
    id: "cmd_clear",
    label: "clear",
    command: "clear",
    runMode: "send"
  }
];

export const defaultSettings: AppSettings = {
  commands: defaultQuickCommands,
  shortcuts: {
    toggleVisibility: {
      accelerator: appConfig.toggleShortcut,
      scope: "global"
    },
    newTab: {
      accelerator: "CmdOrCtrl+T",
      scope: "app"
    },
    closeTab: {
      accelerator: "CmdOrCtrl+W",
      scope: "app"
    },
    nextTab: {
      accelerator: "CmdOrCtrl+Shift+]",
      scope: "app"
    },
    previousTab: {
      accelerator: "CmdOrCtrl+Shift+[",
      scope: "app"
    },
    "selectTab:1": {
      accelerator: "CmdOrCtrl+1",
      scope: "app"
    },
    "selectTab:2": {
      accelerator: "CmdOrCtrl+2",
      scope: "app"
    },
    "selectTab:3": {
      accelerator: "CmdOrCtrl+3",
      scope: "app"
    },
    "selectTab:4": {
      accelerator: "CmdOrCtrl+4",
      scope: "app"
    },
    "selectTab:5": {
      accelerator: "CmdOrCtrl+5",
      scope: "app"
    },
    "selectTab:6": {
      accelerator: "CmdOrCtrl+6",
      scope: "app"
    },
    "selectTab:7": {
      accelerator: "CmdOrCtrl+7",
      scope: "app"
    },
    "selectTab:8": {
      accelerator: "CmdOrCtrl+8",
      scope: "app"
    },
    "selectTab:9": {
      accelerator: "CmdOrCtrl+9",
      scope: "app"
    }
  },
  layout: {
    commandPanelWidth: appConfig.defaultCommandPanelWidth
  }
};
