import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type {
  AppSettings,
  AppSettingsSnapshot,
  CommandHistoryEntry,
  CommandHistoryRecordRequest,
  CompletionItem,
  CompletionRequest,
  CreateTerminalRequest,
  CreateTerminalResponse,
  QuickCommand,
  ShortcutRegistrationError,
  ShellIntegrationStatusEvent,
  TerminalApi,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalKillRequest,
  TerminalResizeRequest,
  TerminalSessionsSnapshot,
  TerminalWriteRequest,
  UpdateInstallResult
} from "../shared/terminalTypes";

const shortcutCallbacks = new Set<(actionId: string) => void>();
let globalShortcutErrors: ShortcutRegistrationError[] = [];

const terminalApi: TerminalApi = {
  getQuickCommands: () => invoke<QuickCommand[]>("quick_commands_list"),

  getAppSettings: async () => {
    const snapshot = await invoke<AppSettingsSnapshot>("settings_get");
    await syncGlobalShortcuts(snapshot.settings);
    return withShortcutErrors(snapshot);
  },

  saveAppSettings: async (settings: AppSettings) => {
    const snapshot = await invoke<AppSettingsSnapshot>("settings_save", { settings });
    await syncGlobalShortcuts(snapshot.settings);
    return withShortcutErrors(snapshot);
  },

  listCommandHistory: () => invoke<CommandHistoryEntry[]>("command_history_list"),

  recordCommandHistory: (request: CommandHistoryRecordRequest) =>
    invoke<CommandHistoryEntry[]>("command_history_record", { request }),

  clearCommandHistory: () => invoke<CommandHistoryEntry[]>("command_history_clear"),

  getTerminalSessions: () => invoke<TerminalSessionsSnapshot>("terminal_sessions_get"),

  saveTerminalSessions: (snapshot: TerminalSessionsSnapshot) =>
    invoke<TerminalSessionsSnapshot>("terminal_sessions_save", { snapshot }),

  clearTerminalSessions: () => invoke<TerminalSessionsSnapshot>("terminal_sessions_clear"),

  getShellIntegrationZshrcSnippet: () => invoke<string>("shell_integration_zshrc_snippet"),

  installShellIntegrationZshrc: () => invoke<string>("shell_integration_install_zshrc"),

  installUpdateIfAvailable: async () => {
    const update = await check();
    if (!update || ("available" in update && update.available === false)) {
      return { available: false };
    }

    const result: UpdateInstallResult = {
      available: true,
      version: update.version
    };
    await update.downloadAndInstall();
    await relaunch();
    return result;
  },

  listCompletions: (request: CompletionRequest) => invoke<CompletionItem[]>("completions_list", { request }),

  createTerminal: (request: CreateTerminalRequest) =>
    invoke<CreateTerminalResponse>("terminal_create", { request }),

  writeTerminal: (request: TerminalWriteRequest) => {
    invoke("terminal_write", { request }).catch((error) => {
      console.warn("Failed to write terminal data", error);
    });
  },

  resizeTerminal: (request: TerminalResizeRequest) => {
    invoke("terminal_resize", { request }).catch((error) => {
      console.warn("Failed to resize terminal", error);
    });
  },

  killTerminal: (request: TerminalKillRequest) => {
    invoke("terminal_kill", { request }).catch((error) => {
      console.warn("Failed to kill terminal", error);
    });
  },

  toggleVisibility: () => {
    invoke("window_toggle_visibility").catch((error) => {
      console.warn("Failed to toggle window visibility", error);
    });
  },

  onShortcutTriggered: (callback: (actionId: string) => void) => {
    shortcutCallbacks.add(callback);
    return () => {
      shortcutCallbacks.delete(callback);
    };
  },

  onTerminalData: (callback: (event: TerminalDataEvent) => void) => {
    let cleanup = () => {};
    listen<TerminalDataEvent>("terminal:data", (event) => {
      callback(event.payload);
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => {
      cleanup();
    };
  },

  onTerminalExit: (callback: (event: TerminalExitEvent) => void) => {
    let cleanup = () => {};
    listen<TerminalExitEvent>("terminal:exit", (event) => {
      callback(event.payload);
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => {
      cleanup();
    };
  },

  onCommandHistoryUpdated: (callback: (entries: CommandHistoryEntry[]) => void) => {
    let cleanup = () => {};
    listen<CommandHistoryEntry[]>("command-history:updated", (event) => {
      callback(event.payload);
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => {
      cleanup();
    };
  },

  onShellIntegrationStatus: (callback: (event: ShellIntegrationStatusEvent) => void) => {
    let cleanup = () => {};
    listen<ShellIntegrationStatusEvent>("shell-integration:status", (event) => {
      callback(event.payload);
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => {
      cleanup();
    };
  }
};

Object.defineProperty(window, "terminalApi", {
  value: terminalApi,
  configurable: false,
  writable: false
});

async function syncGlobalShortcuts(settings: AppSettings): Promise<void> {
  globalShortcutErrors = [];

  try {
    await unregisterAll();
  } catch (error) {
    globalShortcutErrors.push({
      actionId: "globalShortcutCleanup",
      accelerator: "",
      message: `Could not reset global shortcuts: ${String(error)}.`
    });
  }

  for (const [actionId, binding] of Object.entries(settings.shortcuts)) {
    if (binding.scope !== "global" || binding.accelerator.length === 0) {
      continue;
    }

    const accelerator = toTauriAccelerator(binding.accelerator);

    try {
      await register(accelerator, (event) => {
        if (event.state !== "Pressed") {
          return;
        }

        if (actionId === "toggleVisibility") {
          terminalApi.toggleVisibility();
          return;
        }

        for (const callback of shortcutCallbacks) {
          callback(actionId);
        }
      });
    } catch {
      globalShortcutErrors.push({
        actionId,
        accelerator: binding.accelerator,
        message: `Could not register global shortcut: ${binding.accelerator}.`
      });
    }
  }
}

function withShortcutErrors(snapshot: AppSettingsSnapshot): AppSettingsSnapshot {
  return {
    ...snapshot,
    globalShortcutErrors
  };
}

function toTauriAccelerator(accelerator: string): string {
  return accelerator.replaceAll("CmdOrCtrl", "CommandOrControl");
}
