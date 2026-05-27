import os from "node:os";
import process from "node:process";
import pty, { type IPty } from "node-pty";
import { appConfig } from "./config";
import type {
  CreateTerminalRequest,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalTab
} from "../shared/terminalTypes";

type PtySession = {
  tab: TerminalTab;
  process: IPty;
};

type PtyManagerOptions = {
  onData: (event: TerminalDataEvent) => void;
  onExit: (event: TerminalExitEvent) => void;
};

export class PtyManager {
  private readonly sessions = new Map<string, PtySession>();

  public constructor(private readonly options: PtyManagerOptions) {}

  public create(request: CreateTerminalRequest): TerminalTab {
    if (this.sessions.has(request.id)) {
      throw new Error(`Terminal already exists: ${request.id}`);
    }

    const shell = this.resolveShell(request.shell);
    const tab: TerminalTab = {
      id: request.id,
      title: request.title ?? this.shellTitle(shell),
      shell,
      cwd: request.cwd
    };

    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: request.cols ?? appConfig.initialCols,
      rows: request.rows ?? appConfig.initialRows,
      cwd: request.cwd ?? os.homedir(),
      env: process.env
    });

    ptyProcess.onData((data) => {
      this.options.onData({ id: request.id, data });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      this.sessions.delete(request.id);
      this.options.onExit({ id: request.id, exitCode, signal });
    });

    this.sessions.set(request.id, {
      tab,
      process: ptyProcess
    });

    return tab;
  }

  public write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      console.warn(`Cannot write to missing terminal: ${id}`);
      return;
    }

    session.process.write(data);
  }

  public resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session || cols < 1 || rows < 1) {
      return;
    }

    try {
      session.process.resize(cols, rows);
    } catch (error) {
      console.warn(`Failed to resize terminal ${id}`, error);
    }
  }

  public kill(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }

    this.sessions.delete(id);
    try {
      session.process.kill();
    } catch (error) {
      console.warn(`Failed to kill terminal ${id}`, error);
    }
  }

  public killAll(): void {
    for (const id of this.sessions.keys()) {
      this.kill(id);
    }
  }

  private resolveShell(shell?: string): string {
    if (shell) {
      return shell;
    }

    if (process.platform === "win32") {
      return process.env.COMSPEC ?? "powershell.exe";
    }

    return appConfig.defaultShell;
  }

  private shellTitle(shell: string): string {
    const parts = shell.split(/[\\/]/);
    return parts.at(-1) || shell;
  }
}
