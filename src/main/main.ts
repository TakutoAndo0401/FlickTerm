import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PtyManager } from "./ptyManager";
import { SettingsStore } from "./settingsStore";
import type {
  AppSettings,
  CreateTerminalRequest,
  CreateTerminalResponse,
  ShortcutRegistrationError,
  TerminalKillRequest,
  TerminalResizeRequest,
  TerminalWriteRequest
} from "../shared/terminalTypes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

const ptyManager = new PtyManager({
  onData: (event) => {
    sendToRenderer("terminal:data", event);
  },
  onExit: (event) => {
    sendToRenderer("terminal:exit", event);
  }
});
const settingsStore = new SettingsStore();
let globalShortcutErrors: ShortcutRegistrationError[] = [];

function sendToRenderer(
  channel: "terminal:data" | "terminal:exit" | "shortcut:triggered",
  payload: unknown
): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(channel, payload);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 420,
    show: false,
    title: "FlickTerm",
    backgroundColor: "#111315",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/preload.cjs")
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL).catch((error) => {
      console.error("Failed to load renderer URL", error);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html")).catch((error) => {
      console.error("Failed to load renderer file", error);
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle("quickCommands:list", () => settingsStore.getSettings().commands);

  ipcMain.handle("settings:get", () => settingsStore.getSnapshot(globalShortcutErrors));

  ipcMain.handle("settings:save", async (_event, settings: AppSettings) => {
    await settingsStore.save(settings);
    registerGlobalShortcuts();
    return settingsStore.getSnapshot(globalShortcutErrors);
  });

  ipcMain.handle(
    "terminal:create",
    (_event, request: CreateTerminalRequest): CreateTerminalResponse => {
      const tab = ptyManager.create(request);
      return { tab };
    }
  );

  ipcMain.on("terminal:write", (_event, request: TerminalWriteRequest) => {
    ptyManager.write(request.id, request.data);
  });

  ipcMain.on("terminal:resize", (_event, request: TerminalResizeRequest) => {
    ptyManager.resize(request.id, request.cols, request.rows);
  });

  ipcMain.on("terminal:kill", (_event, request: TerminalKillRequest) => {
    ptyManager.kill(request.id);
  });

  ipcMain.on("window:toggleVisibility", () => {
    toggleWindowVisibility();
  });
}

function toggleWindowVisibility(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
    return;
  }

  mainWindow.show();
  mainWindow.focus();
}

function registerGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
  globalShortcutErrors = [];

  for (const [actionId, binding] of Object.entries(settingsStore.getSettings().shortcuts)) {
    if (binding.scope !== "global" || binding.accelerator.length === 0) {
      continue;
    }

    const registered = globalShortcut.register(binding.accelerator, () => {
      if (actionId === "toggleVisibility") {
        toggleWindowVisibility();
        return;
      }

      sendToRenderer("shortcut:triggered", actionId);
    });

    if (!registered) {
      globalShortcutErrors.push({
        actionId,
        accelerator: binding.accelerator,
        message: `Could not register global shortcut: ${binding.accelerator}.`
      });
      console.warn(`Failed to register global shortcut: ${binding.accelerator}`);
    }
  }
}

app.whenReady().then(async () => {
  await settingsStore.load();
  registerIpc();
  createWindow();
  registerGlobalShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});

app.on("before-quit", () => {
  ptyManager.killAll();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  ptyManager.killAll();

  if (process.platform !== "darwin") {
    app.quit();
  }
});
