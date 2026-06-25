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

export type AppLanguage = "en" | "ja";

export type LayoutSettings = {
  commandPanelWidth: number;
};

export type AppearanceSettings = {
  fontFamily: string;
  fontSize: number;
  letterSpacing: number;
  lineHeight: number;
  cursorStyle: CursorStyle;
};

export type CursorStyle = "block" | "bar" | "underline";

export type FeatureSettings = {
  commandHistory: {
    enabled: boolean;
    maxEntries: number;
    shellIntegration: boolean;
  };
  autosuggestions: {
    enabled: boolean;
    acceptWithTab: boolean;
  };
  sessionRestore: {
    enabled: boolean;
  };
};

export type AppSettings = {
  language: AppLanguage;
  commands: QuickCommand[];
  shortcuts: Record<string, ShortcutBinding>;
  layout: LayoutSettings;
  appearance: AppearanceSettings;
  features: FeatureSettings;
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

export type CompletionKind = "file" | "directory";

export type CompletionRequest = {
  cwd?: string;
  token: string;
  directoriesOnly: boolean;
};

export type CompletionItem = {
  name: string;
  display: string;
  insertText: string;
  kind: CompletionKind;
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

export type CommandHistoryEntry = {
  command: string;
  cwd?: string;
  runCount: number;
  firstRunAt: string;
  lastRunAt: string;
  lastExitCode: number | null;
  lastDurationMs: number | null;
};

export type CommandHistoryRecordRequest = {
  command: string;
  cwd?: string;
  maxEntries: number;
};

export type ShellIntegrationStatusEvent = {
  id: string;
  detected: boolean;
  cwd?: string;
};

export type TerminalSessionTab = {
  id: string;
  title: string;
  shell: string;
  cwd?: string;
  cols: number;
  rows: number;
  serialized: string;
  updatedAt: string;
};

export type TerminalSessionsSnapshot = {
  version: number;
  activeTabId?: string;
  tabs: TerminalSessionTab[];
  closedTabs: TerminalSessionTab[];
};

export type UpdateInstallResult = {
  available: boolean;
  version?: string;
};

export type TerminalApi = {
  getQuickCommands: () => Promise<QuickCommand[]>;
  getAppSettings: () => Promise<AppSettingsSnapshot>;
  saveAppSettings: (settings: AppSettings) => Promise<AppSettingsSnapshot>;
  listCommandHistory: () => Promise<CommandHistoryEntry[]>;
  recordCommandHistory: (request: CommandHistoryRecordRequest) => Promise<CommandHistoryEntry[]>;
  clearCommandHistory: () => Promise<CommandHistoryEntry[]>;
  getTerminalSessions: () => Promise<TerminalSessionsSnapshot>;
  saveTerminalSessions: (snapshot: TerminalSessionsSnapshot) => Promise<TerminalSessionsSnapshot>;
  clearTerminalSessions: () => Promise<TerminalSessionsSnapshot>;
  getShellIntegrationZshrcSnippet: () => Promise<string>;
  installShellIntegrationZshrc: () => Promise<string>;
  installUpdateIfAvailable: () => Promise<UpdateInstallResult>;
  listCompletions: (request: CompletionRequest) => Promise<CompletionItem[]>;
  createTerminal: (request: CreateTerminalRequest) => Promise<CreateTerminalResponse>;
  writeTerminal: (request: TerminalWriteRequest) => void;
  resizeTerminal: (request: TerminalResizeRequest) => void;
  killTerminal: (request: TerminalKillRequest) => void;
  toggleVisibility: () => void;
  onShortcutTriggered: (callback: (actionId: string) => void) => () => void;
  onTerminalData: (callback: (event: TerminalDataEvent) => void) => () => void;
  onTerminalExit: (callback: (event: TerminalExitEvent) => void) => () => void;
  onCommandHistoryUpdated: (callback: (entries: CommandHistoryEntry[]) => void) => () => void;
  onShellIntegrationStatus: (callback: (event: ShellIntegrationStatusEvent) => void) => () => void;
};

declare global {
  interface Window {
    terminalApi: TerminalApi;
  }
}
