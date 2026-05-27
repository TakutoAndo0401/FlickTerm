import { contextBridge, ipcRenderer } from "electron";
import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  QuickCommand,
  TerminalApi,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalKillRequest,
  TerminalResizeRequest,
  TerminalWriteRequest
} from "../shared/terminalTypes";

const terminalApi: TerminalApi = {
  getQuickCommands: () => ipcRenderer.invoke("quickCommands:list") as Promise<QuickCommand[]>,

  createTerminal: (request: CreateTerminalRequest) =>
    ipcRenderer.invoke("terminal:create", request) as Promise<CreateTerminalResponse>,

  writeTerminal: (request: TerminalWriteRequest) => {
    ipcRenderer.send("terminal:write", request);
  },

  resizeTerminal: (request: TerminalResizeRequest) => {
    ipcRenderer.send("terminal:resize", request);
  },

  killTerminal: (request: TerminalKillRequest) => {
    ipcRenderer.send("terminal:kill", request);
  },

  onTerminalData: (callback: (event: TerminalDataEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent): void => {
      callback(payload);
    };

    ipcRenderer.on("terminal:data", listener);
    return () => {
      ipcRenderer.removeListener("terminal:data", listener);
    };
  },

  onTerminalExit: (callback: (event: TerminalExitEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent): void => {
      callback(payload);
    };

    ipcRenderer.on("terminal:exit", listener);
    return () => {
      ipcRenderer.removeListener("terminal:exit", listener);
    };
  }
};

contextBridge.exposeInMainWorld("terminalApi", terminalApi);
