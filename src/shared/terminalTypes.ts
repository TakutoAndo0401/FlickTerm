export type TerminalTab = {
  id: string;
  title: string;
  shell: string;
  cwd?: string;
};

export type QuickCommand = {
  label: string;
  command: string;
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
  data: string;
};

export type TerminalExitEvent = {
  id: string;
  exitCode: number;
  signal?: number;
};

export type TerminalApi = {
  getQuickCommands: () => Promise<QuickCommand[]>;
  createTerminal: (request: CreateTerminalRequest) => Promise<CreateTerminalResponse>;
  writeTerminal: (request: TerminalWriteRequest) => void;
  resizeTerminal: (request: TerminalResizeRequest) => void;
  killTerminal: (request: TerminalKillRequest) => void;
  onTerminalData: (callback: (event: TerminalDataEvent) => void) => () => void;
  onTerminalExit: (callback: (event: TerminalExitEvent) => void) => () => void;
};

declare global {
  interface Window {
    terminalApi: TerminalApi;
  }
}
