import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultSettings } from "./config";
import type {
  AppSettings,
  AppSettingsSnapshot,
  QuickCommand,
  QuickCommandRunMode,
  ShortcutBinding,
  ShortcutRegistrationError,
  ShortcutScope
} from "../shared/terminalTypes";

type SettingsLoadResult = {
  settings: AppSettings;
  notice?: string;
};

const settingsFileName = "settings.json";

const runModes = new Set<QuickCommandRunMode>(["send", "insert", "confirm"]);
const shortcutScopes = new Set<ShortcutScope>(["global", "app", "disabled"]);

export class SettingsStore {
  private settings: AppSettings = cloneSettings(defaultSettings);
  private notice: string | undefined;

  async load(): Promise<void> {
    const result = await this.readFromDisk();
    this.settings = result.settings;
    this.notice = result.notice;
    await this.persist();
  }

  getSnapshot(globalShortcutErrors: ShortcutRegistrationError[]): AppSettingsSnapshot {
    return {
      settings: cloneSettings(this.settings),
      defaults: cloneSettings(defaultSettings),
      globalShortcutErrors,
      notice: this.notice
    };
  }

  getSettings(): AppSettings {
    return cloneSettings(this.settings);
  }

  async save(settings: AppSettings): Promise<void> {
    this.settings = normalizeSettings(settings);
    this.notice = undefined;
    await this.persist();
  }

  private async readFromDisk(): Promise<SettingsLoadResult> {
    const filePath = getSettingsPath();

    try {
      const raw = await readFile(filePath, "utf8");
      return {
        settings: normalizeSettings(JSON.parse(raw) as unknown)
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return {
          settings: cloneSettings(defaultSettings)
        };
      }

      await backupInvalidSettings(filePath);
      return {
        settings: cloneSettings(defaultSettings),
        notice: "Settings file was invalid and has been reset."
      };
    }
  }

  private async persist(): Promise<void> {
    const filePath = getSettingsPath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(this.settings, null, 2)}\n`, "utf8");
  }
}

function normalizeSettings(value: unknown): AppSettings {
  if (!isRecord(value)) {
    throw new Error("Settings must be an object.");
  }

  const commands = normalizeCommands(value.commands);
  const commandIds = new Set(commands.map((command) => command.id));
  const shortcuts = normalizeShortcuts(value.shortcuts, commandIds);

  return {
    commands,
    shortcuts
  };
}

function normalizeCommands(value: unknown): QuickCommand[] {
  if (!Array.isArray(value)) {
    throw new Error("Settings commands must be an array.");
  }

  const seen = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error("Command must be an object.");
    }

    const id = readRequiredString(item.id, "Command id");
    const label = readRequiredString(item.label, "Command label");
    const command = readRequiredString(item.command, "Command text");
    const runMode = item.runMode;

    if (seen.has(id)) {
      throw new Error(`Duplicate command id: ${id}`);
    }

    if (typeof runMode !== "string" || !runModes.has(runMode as QuickCommandRunMode)) {
      throw new Error(`Invalid command run mode: ${String(runMode)}`);
    }

    seen.add(id);
    return {
      id,
      label,
      command,
      runMode: runMode as QuickCommandRunMode
    };
  });
}

function normalizeShortcuts(value: unknown, commandIds: Set<string>): Record<string, ShortcutBinding> {
  if (!isRecord(value)) {
    throw new Error("Settings shortcuts must be an object.");
  }

  const shortcuts: Record<string, ShortcutBinding> = {};

  for (const [actionId, binding] of Object.entries(defaultSettings.shortcuts)) {
    shortcuts[actionId] = { ...binding };
  }

  for (const [actionId, rawBinding] of Object.entries(value)) {
    if (actionId.startsWith("runCommand:")) {
      const commandId = actionId.slice("runCommand:".length);
      if (!commandIds.has(commandId)) {
        continue;
      }
    }

    shortcuts[actionId] = normalizeShortcutBinding(rawBinding);
  }

  return shortcuts;
}

function normalizeShortcutBinding(value: unknown): ShortcutBinding {
  if (!isRecord(value)) {
    throw new Error("Shortcut binding must be an object.");
  }

  const accelerator = typeof value.accelerator === "string" ? value.accelerator.trim() : "";
  const scope = value.scope;

  if (typeof scope !== "string" || !shortcutScopes.has(scope as ShortcutScope)) {
    throw new Error(`Invalid shortcut scope: ${String(scope)}`);
  }

  return {
    accelerator,
    scope: scope as ShortcutScope
  };
}

async function backupInvalidSettings(filePath: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const backupPath = path.join(path.dirname(filePath), `settings.invalid-${stamp}.json`);

  try {
    await rename(filePath, backupPath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      console.warn("Failed to back up invalid settings", error);
    }
  }
}

function getSettingsPath(): string {
  return path.join(app.getPath("userData"), settingsFileName);
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    commands: settings.commands.map((command) => ({ ...command })),
    shortcuts: Object.fromEntries(
      Object.entries(settings.shortcuts).map(([actionId, binding]) => [actionId, { ...binding }])
    )
  };
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
