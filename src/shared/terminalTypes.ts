export type TerminalTab = {
  id: string;
  title: string;
  shell: string;
  cwd?: string;
};

export type QuickCommand = {
  id: string;
  label: string;
  command: string;
  runMode: QuickCommandRunMode;
};

export type QuickCommandRunMode = "send" | "insert" | "confirm";

export type ShortcutScope = "global" | "app" | "disabled";

export type ShortcutBinding = {
  accelerator: string;
  scope: ShortcutScope;
};

export type LayoutSettings = {
  commandPanelWidth: number;
};

export type AppSettings = {
  commands: QuickCommand[];
  shortcuts: Record<string, ShortcutBinding>;
  layout: LayoutSettings;
};

export type ShortcutRegistrationError = {
  actionId: string;
  accelerator: string;
  message: string;
};

export type AppSettingsSnapshot = {
  settings: AppSettings;
  defaults: AppSettings;
  globalShortcutErrors: ShortcutRegistrationError[];
  notice?: string;
};

export type CreateTerminalRequest = {
  id: string;
  title?: string;
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
};

export type CreateTerminalResponse = {
  tab: TerminalTab;
};

export type TerminalWriteRequest = {
  id: string;
  data: string;
};

export type TerminalResizeRequest = {
  id: string;
  cols: number;
  rows: number;
};

export type TerminalKillRequest = {
  id: string;
};

export type TerminalDataEvent = {
  id: string;
  data: number[];
};

export type TerminalExitEvent = {
  id: string;
  exitCode: number;
  signal?: number;
};

export type UpdateInstallResult = {
  available: boolean;
  version?: string;
};

export type TerminalApi = {
  getQuickCommands: () => Promise<QuickCommand[]>;
  getAppSettings: () => Promise<AppSettingsSnapshot>;
  saveAppSettings: (settings: AppSettings) => Promise<AppSettingsSnapshot>;
  installUpdateIfAvailable: () => Promise<UpdateInstallResult>;
  createTerminal: (request: CreateTerminalRequest) => Promise<CreateTerminalResponse>;
  writeTerminal: (request: TerminalWriteRequest) => void;
  resizeTerminal: (request: TerminalResizeRequest) => void;
  killTerminal: (request: TerminalKillRequest) => void;
  toggleVisibility: () => void;
  onShortcutTriggered: (callback: (actionId: string) => void) => () => void;
  onTerminalData: (callback: (event: TerminalDataEvent) => void) => () => void;
  onTerminalExit: (callback: (event: TerminalExitEvent) => void) => () => void;
};

declare global {
  interface Window {
    terminalApi: TerminalApi;
  }
}
