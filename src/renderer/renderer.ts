import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import "./tauriApi";
import { createTerminalView, type RendererTerminalTab } from "./terminalTabs";
import type {
  AppSettings,
  AppSettingsSnapshot,
  QuickCommand,
  QuickCommandRunMode,
  ShortcutBinding,
  ShortcutScope,
  TerminalTab
} from "../shared/terminalTypes";

type ShortcutAction = {
  id: string;
  label: string;
  hint?: string;
  defaultScope: ShortcutScope;
};

type ValidationResult = {
  valid: boolean;
  messages: string[];
};

const tabsElement = getElement("tabs");
const newTabButton = getElement("new-tab-button") as HTMLButtonElement;
const workspaceElement = getElement("workspace");
const settingsButton = getElement("settings-button") as HTMLButtonElement;
const quickCommandsElement = getElement("quick-commands");
const commandPanelResizeHandle = getElement("command-panel-resize-handle");
const terminalHost = getElement("terminal-host");
const settingsOverlay = getElement("settings-overlay");
const settingsDialog = getElement("settings-dialog");
const settingsCloseButton = getElement("settings-close-button") as HTMLButtonElement;
const settingsTabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".settings-tab"));
const settingsCommandsPanel = getElement("settings-commands-panel");
const settingsShortcutsPanel = getElement("settings-shortcuts-panel");
const settingsStatusElement = getElement("settings-status");
const settingsNoticeElement = getElement("settings-notice");
const commandsEditorElement = getElement("commands-editor");
const shortcutsEditorElement = getElement("shortcuts-editor");
const addCommandButton = getElement("add-command-button") as HTMLButtonElement;
const resetCommandsButton = getElement("reset-commands-button") as HTMLButtonElement;
const resetShortcutsButton = getElement("reset-shortcuts-button") as HTMLButtonElement;
const cancelSettingsButton = getElement("cancel-settings-button") as HTMLButtonElement;
const saveSettingsButton = getElement("save-settings-button") as HTMLButtonElement;

const fixedShortcutActions: ShortcutAction[] = [
  { id: "toggleVisibility", label: "Toggle Visibility", defaultScope: "global" },
  { id: "newTab", label: "New Tab", defaultScope: "app" },
  { id: "closeTab", label: "Close Tab", defaultScope: "app" },
  { id: "nextTab", label: "Next Tab", defaultScope: "app" },
  { id: "previousTab", label: "Previous Tab", defaultScope: "app" },
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `selectTab:${index + 1}`,
    label: `Select Tab ${index + 1}`,
    defaultScope: "app" as const
  }))
];

const commandPanelWidthDefault = 168;
const commandPanelWidthMin = 120;
const commandPanelWidthMax = 360;
const commandPanelKeyboardStep = 10;

const tabs = new Map<string, RendererTerminalTab>();
let activeTabId: string | null = null;
let tabCounter = 0;
let resizeTimer: number | undefined;
let commandPanelWidth = commandPanelWidthDefault;
let commandPanelResizeState:
  | {
      pointerId: number;
      startX: number;
      startWidth: number;
    }
  | undefined;
let settingsSnapshot: AppSettingsSnapshot | null = null;
let appSettings: AppSettings | null = null;
let draftSettings: AppSettings | null = null;
let settingsTab: "commands" | "shortcuts" = "commands";
let recordingActionId: string | null = null;

window.terminalApi.onTerminalData(({ id, data }) => {
  tabs.get(id)?.terminal.write(data);
});

window.terminalApi.onTerminalExit(({ id, exitCode }) => {
  const view = tabs.get(id);
  if (!view) {
    return;
  }

  view.terminal.writeln("");
  view.terminal.writeln(`[process exited with code ${exitCode}]`);
});

window.terminalApi.onShortcutTriggered((actionId) => {
  runShortcutAction(actionId);
});

document.addEventListener(
  "keydown",
  (event) => {
    if (recordingActionId) {
      handleShortcutRecording(event);
      return;
    }

    if (event.key === "Escape" && isSettingsOpen()) {
      event.preventDefault();
      closeSettingsWithConfirmation();
      return;
    }

    if (isSettingsOpen()) {
      return;
    }

    const actionId = getAppShortcutActionId(event);
    if (!actionId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    runShortcutAction(actionId);
  },
  true
);

newTabButton.addEventListener("click", () => {
  createTab().catch((error) => {
    console.error("Failed to create tab", error);
  });
});

settingsButton.addEventListener("click", () => {
  openSettings();
});

commandPanelResizeHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  commandPanelResizeState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: commandPanelWidth
  };
  commandPanelResizeHandle.setPointerCapture(event.pointerId);
  workspaceElement.classList.add("is-resizing-panel");
});

commandPanelResizeHandle.addEventListener("pointermove", (event) => {
  if (!commandPanelResizeState || event.pointerId !== commandPanelResizeState.pointerId) {
    return;
  }

  const nextWidth = commandPanelResizeState.startWidth + event.clientX - commandPanelResizeState.startX;
  setCommandPanelWidth(nextWidth);
});

commandPanelResizeHandle.addEventListener("pointerup", (event) => {
  finishCommandPanelResize(event.pointerId);
});

commandPanelResizeHandle.addEventListener("pointercancel", (event) => {
  finishCommandPanelResize(event.pointerId);
});

commandPanelResizeHandle.addEventListener("keydown", (event) => {
  let nextWidth: number | undefined;

  if (event.key === "ArrowLeft") {
    nextWidth = commandPanelWidth - commandPanelKeyboardStep;
  } else if (event.key === "ArrowRight") {
    nextWidth = commandPanelWidth + commandPanelKeyboardStep;
  } else if (event.key === "Home") {
    nextWidth = commandPanelWidthMin;
  } else if (event.key === "End") {
    nextWidth = commandPanelWidthMax;
  }

  if (nextWidth === undefined) {
    return;
  }

  event.preventDefault();
  setCommandPanelWidth(nextWidth);
  saveCommandPanelWidth().catch((error) => {
    console.error("Failed to save command panel width", error);
  });
});

settingsCloseButton.addEventListener("click", () => {
  closeSettingsWithConfirmation();
});

settingsOverlay.addEventListener("click", (event) => {
  if (event.target === settingsOverlay) {
    closeSettingsWithConfirmation();
  }
});

for (const tabButton of settingsTabs) {
  tabButton.addEventListener("click", () => {
    const tab = tabButton.dataset.settingsTab;
    if (tab === "commands" || tab === "shortcuts") {
      settingsTab = tab;
      renderSettingsModal();
    }
  });
}

addCommandButton.addEventListener("click", () => {
  if (!draftSettings) {
    return;
  }

  draftSettings.commands.push({
    id: `cmd_${crypto.randomUUID()}`,
    label: "New command",
    command: "",
    runMode: "send"
  });
  renderSettingsModal();
});

resetCommandsButton.addEventListener("click", () => {
  if (!draftSettings || !settingsSnapshot) {
    return;
  }

  if (!window.confirm("Reset Commands to defaults?")) {
    return;
  }

  const defaultCommandIds = new Set(settingsSnapshot.defaults.commands.map((command) => command.id));
  draftSettings.commands = cloneSettings(settingsSnapshot.defaults).commands;
  draftSettings.shortcuts = Object.fromEntries(
    Object.entries(draftSettings.shortcuts).filter(([actionId]) => {
      if (!actionId.startsWith("runCommand:")) {
        return true;
      }

      return defaultCommandIds.has(actionId.slice("runCommand:".length));
    })
  );
  renderSettingsModal();
});

resetShortcutsButton.addEventListener("click", () => {
  if (!draftSettings || !settingsSnapshot) {
    return;
  }

  if (!window.confirm("Reset Shortcuts to defaults?")) {
    return;
  }

  draftSettings.shortcuts = cloneSettings(settingsSnapshot.defaults).shortcuts;
  renderSettingsModal();
});

cancelSettingsButton.addEventListener("click", () => {
  closeSettingsWithConfirmation();
});

saveSettingsButton.addEventListener("click", () => {
  saveSettings().catch((error) => {
    showSettingsStatus(error instanceof Error ? error.message : "Failed to save settings.", true);
  });
});

const resizeObserver = new ResizeObserver(() => {
  scheduleFitActiveTerminal();
});
resizeObserver.observe(terminalHost);

init().catch((error) => {
  console.error("Failed to initialize renderer", error);
});

async function init(): Promise<void> {
  await reloadSettings();
  renderQuickCommands();
  await createTab();
}

async function reloadSettings(): Promise<void> {
  settingsSnapshot = await window.terminalApi.getAppSettings();
  appSettings = cloneSettings(settingsSnapshot.settings);
  setCommandPanelWidth(appSettings.layout.commandPanelWidth);
  showSettingsNotice(settingsSnapshot.notice ?? "");
}

async function createTab(): Promise<void> {
  tabCounter += 1;
  const id = `terminal-${crypto.randomUUID()}`;
  const title = `zsh ${tabCounter}`;
  const response = await window.terminalApi.createTerminal({
    id,
    title,
    cols: 80,
    rows: 24
  });

  attachTerminal(response.tab);
  activateTab(response.tab.id);
}

function attachTerminal(tab: TerminalTab): void {
  const view = createTerminalView(tab);

  tabs.set(tab.id, view);
  terminalHost.append(view.element);
  view.terminal.open(view.element);
  view.terminal.onData((data) => {
    window.terminalApi.writeTerminal({ id: tab.id, data });
  });
  view.terminal.onResize(({ cols, rows }) => {
    window.terminalApi.resizeTerminal({ id: tab.id, cols, rows });
  });

  renderTabs();
}

function activateTab(id: string): void {
  if (!tabs.has(id)) {
    return;
  }

  activeTabId = id;

  for (const [tabId, view] of tabs) {
    const active = tabId === id;
    view.element.classList.toggle("is-active", active);
    if (active) {
      view.fitAddon.fit();
      view.terminal.focus();
      window.terminalApi.resizeTerminal({
        id: tabId,
        cols: view.terminal.cols,
        rows: view.terminal.rows
      });
    }
  }

  renderTabs();
}

function closeActiveTab(): void {
  if (!activeTabId) {
    return;
  }

  closeTab(activeTabId);
}

function closeTab(id: string): void {
  const view = tabs.get(id);
  if (!view) {
    return;
  }

  window.terminalApi.killTerminal({ id });
  view.terminal.dispose();
  view.element.remove();
  tabs.delete(id);

  if (activeTabId === id) {
    const nextId = tabs.keys().next().value as string | undefined;
    activeTabId = null;

    if (nextId) {
      activateTab(nextId);
    } else {
      createTab().catch((error) => {
        console.error("Failed to create replacement tab", error);
      });
    }
  } else {
    renderTabs();
  }
}

function activateRelativeTab(direction: 1 | -1): void {
  const ids = Array.from(tabs.keys());
  if (!activeTabId || ids.length === 0) {
    return;
  }

  const currentIndex = ids.indexOf(activeTabId);
  if (currentIndex === -1) {
    return;
  }

  const nextIndex = (currentIndex + direction + ids.length) % ids.length;
  const nextId = ids[nextIndex];
  if (nextId) {
    activateTab(nextId);
  }
}

function activateTabAt(index: number): void {
  const id = Array.from(tabs.keys())[index];
  if (id) {
    activateTab(id);
  }
}

function renderTabs(): void {
  tabsElement.replaceChildren();

  for (const [id, view] of tabs) {
    const tabItem = document.createElement("div");
    tabItem.className = "tab-item";
    tabItem.classList.toggle("is-active", id === activeTabId);

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "tab-select";
    selectButton.title = view.metadata.shell;
    selectButton.addEventListener("click", () => {
      activateTab(id);
    });

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = view.metadata.title;

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "tab-close";
    closeButton.title = "Close tab";
    closeButton.textContent = "x";
    closeButton.addEventListener("click", () => {
      closeTab(id);
    });

    selectButton.append(label);
    tabItem.append(selectButton, closeButton);
    tabsElement.append(tabItem);
  }
}

function renderQuickCommands(): void {
  quickCommandsElement.replaceChildren();

  for (const command of appSettings?.commands ?? []) {
    quickCommandsElement.append(createQuickCommandButton(command));
  }
}

function setCommandPanelWidth(width: number): void {
  commandPanelWidth = clamp(width, commandPanelWidthMin, commandPanelWidthMax);
  workspaceElement.style.setProperty("--command-panel-width", `${commandPanelWidth}px`);
  commandPanelResizeHandle.setAttribute("aria-valuenow", String(commandPanelWidth));

  if (appSettings) {
    appSettings.layout.commandPanelWidth = commandPanelWidth;
  }
}

async function saveCommandPanelWidth(): Promise<void> {
  if (!appSettings) {
    return;
  }

  const snapshot = await window.terminalApi.saveAppSettings(appSettings);
  settingsSnapshot = snapshot;
  appSettings = cloneSettings(snapshot.settings);
  setCommandPanelWidth(appSettings.layout.commandPanelWidth);
  showSettingsNotice(snapshot.notice ?? "");
}

function finishCommandPanelResize(pointerId: number): void {
  if (!commandPanelResizeState || pointerId !== commandPanelResizeState.pointerId) {
    return;
  }

  commandPanelResizeState = undefined;
  workspaceElement.classList.remove("is-resizing-panel");

  if (commandPanelResizeHandle.hasPointerCapture(pointerId)) {
    commandPanelResizeHandle.releasePointerCapture(pointerId);
  }

  saveCommandPanelWidth().catch((error) => {
    console.error("Failed to save command panel width", error);
  });
}

function createQuickCommandButton(command: QuickCommand): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quick-command-button";
  button.textContent = command.label;
  button.title = command.command;
  button.addEventListener("click", () => {
    runCommand(command);
  });

  return button;
}

function runCommand(command: QuickCommand): void {
  if (!activeTabId) {
    return;
  }

  if (command.runMode === "confirm" && !window.confirm(`Run this command?\n${command.command}`)) {
    return;
  }

  window.terminalApi.writeTerminal({
    id: activeTabId,
    data: command.runMode === "insert" ? command.command : `${command.command}\r`
  });
}

function runShortcutAction(actionId: string): void {
  if (actionId === "toggleVisibility") {
    window.terminalApi.toggleVisibility();
    return;
  }

  if (actionId === "newTab") {
    createTab().catch((error) => {
      console.error("Failed to create tab", error);
    });
    return;
  }

  if (actionId === "closeTab") {
    closeActiveTab();
    return;
  }

  if (actionId === "nextTab") {
    activateRelativeTab(1);
    return;
  }

  if (actionId === "previousTab") {
    activateRelativeTab(-1);
    return;
  }

  if (actionId.startsWith("selectTab:")) {
    const index = Number(actionId.slice("selectTab:".length)) - 1;
    if (Number.isInteger(index)) {
      activateTabAt(index);
    }
    return;
  }

  if (actionId.startsWith("runCommand:")) {
    const commandId = actionId.slice("runCommand:".length);
    const command = appSettings?.commands.find((item) => item.id === commandId);
    if (command) {
      runCommand(command);
    }
  }
}

function getAppShortcutActionId(event: KeyboardEvent): string | null {
  const accelerator = eventToAccelerator(event);
  if (!accelerator || !appSettings) {
    return null;
  }

  for (const [actionId, binding] of Object.entries(appSettings.shortcuts)) {
    if (binding.scope === "app" && binding.accelerator === accelerator) {
      return actionId;
    }
  }

  return null;
}

function openSettings(): void {
  if (!appSettings) {
    return;
  }

  draftSettings = cloneSettings(appSettings);
  recordingActionId = null;
  settingsTab = "commands";
  showSettingsStatus("", false);
  settingsOverlay.classList.add("is-open");
  settingsOverlay.setAttribute("aria-hidden", "false");
  renderSettingsModal();
  settingsDialog.focus();
}

function closeSettingsWithConfirmation(): void {
  if (!isSettingsOpen()) {
    return;
  }

  if (hasUnsavedChanges() && !window.confirm("Discard unsaved settings changes?")) {
    return;
  }

  closeSettings();
}

function closeSettings(): void {
  recordingActionId = null;
  draftSettings = null;
  settingsOverlay.classList.remove("is-open");
  settingsOverlay.setAttribute("aria-hidden", "true");
}

function isSettingsOpen(): boolean {
  return settingsOverlay.classList.contains("is-open");
}

function renderSettingsModal(): void {
  if (!draftSettings) {
    return;
  }

  for (const tabButton of settingsTabs) {
    tabButton.classList.toggle("is-active", tabButton.dataset.settingsTab === settingsTab);
  }

  settingsCommandsPanel.classList.toggle("is-active", settingsTab === "commands");
  settingsShortcutsPanel.classList.toggle("is-active", settingsTab === "shortcuts");
  renderCommandEditor();
  renderShortcutEditor();
  updateSaveState();
}

function renderCommandEditor(): void {
  if (!draftSettings) {
    return;
  }

  commandsEditorElement.replaceChildren();

  for (const command of draftSettings.commands) {
    const row = document.createElement("div");
    row.className = "command-editor-row";

    const labelInput = createTextInput(command.label, "Label");
    labelInput.addEventListener("input", () => {
      command.label = labelInput.value;
      renderShortcutEditor();
      updateSaveState();
    });

    const commandInput = createTextInput(command.command, "Command");
    commandInput.addEventListener("input", () => {
      command.command = commandInput.value;
      updateSaveState();
    });

    const runModeSelect = document.createElement("select");
    runModeSelect.className = "settings-select";
    for (const [value, label] of [
      ["send", "Run"],
      ["insert", "Insert"],
      ["confirm", "Confirm"]
    ] satisfies Array<[QuickCommandRunMode, string]>) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      runModeSelect.append(option);
    }
    runModeSelect.value = command.runMode;
    runModeSelect.addEventListener("change", () => {
      command.runMode = runModeSelect.value as QuickCommandRunMode;
      updateSaveState();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "settings-danger-button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
      if (!draftSettings || !window.confirm(`Delete "${command.label}"?`)) {
        return;
      }

      draftSettings.commands = draftSettings.commands.filter((item) => item.id !== command.id);
      delete draftSettings.shortcuts[`runCommand:${command.id}`];
      renderSettingsModal();
    });

    row.append(labelInput, commandInput, runModeSelect, deleteButton);
    commandsEditorElement.append(row);
  }
}

function renderShortcutEditor(): void {
  if (!draftSettings) {
    return;
  }

  shortcutsEditorElement.replaceChildren();

  for (const action of getShortcutActions(draftSettings)) {
    const binding = getBinding(draftSettings, action);
    const row = document.createElement("div");
    row.className = "shortcut-editor-row";

    const label = document.createElement("div");
    label.className = "shortcut-action-label";
    label.textContent = action.label;
    if (action.hint) {
      label.title = action.hint;
    }

    const scopeSelect = document.createElement("select");
    scopeSelect.className = "settings-select";
    for (const scope of ["app", "global", "disabled"] satisfies ShortcutScope[]) {
      const option = document.createElement("option");
      option.value = scope;
      option.textContent = scope;
      scopeSelect.append(option);
    }
    scopeSelect.value = binding.scope;
    scopeSelect.addEventListener("change", () => {
      if (!draftSettings) {
        return;
      }

      draftSettings.shortcuts[action.id] = {
        ...binding,
        scope: scopeSelect.value as ShortcutScope
      };
      renderShortcutEditor();
      updateSaveState();
    });

    const recordButton = document.createElement("button");
    recordButton.type = "button";
    recordButton.className = "shortcut-record-button";
    recordButton.dataset.actionId = action.id;
    recordButton.textContent =
      recordingActionId === action.id
        ? "Press keys..."
        : binding.accelerator
          ? displayAccelerator(binding.accelerator)
          : "Unassigned";
    recordButton.addEventListener("click", () => {
      recordingActionId = action.id;
      renderShortcutEditor();
    });

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "settings-secondary-button";
    clearButton.textContent = "Clear";
    clearButton.addEventListener("click", () => {
      if (!draftSettings) {
        return;
      }

      draftSettings.shortcuts[action.id] = {
        accelerator: "",
        scope: "disabled"
      };
      renderShortcutEditor();
      updateSaveState();
    });

    row.append(label, scopeSelect, recordButton, clearButton);
    shortcutsEditorElement.append(row);
  }
}

function handleShortcutRecording(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();

  if (!recordingActionId || !draftSettings) {
    return;
  }

  if (event.key === "Escape") {
    recordingActionId = null;
    renderShortcutEditor();
    return;
  }

  if (event.key === "Backspace" || event.key === "Delete") {
    draftSettings.shortcuts[recordingActionId] = {
      accelerator: "",
      scope: "disabled"
    };
    recordingActionId = null;
    renderSettingsModal();
    return;
  }

  const accelerator = eventToAccelerator(event);
  if (!accelerator) {
    showSettingsStatus("Shortcut must include Cmd/Ctrl or Alt.", true);
    return;
  }

  const previous = draftSettings.shortcuts[recordingActionId];
  draftSettings.shortcuts[recordingActionId] = {
    accelerator,
    scope: previous?.scope === "disabled" ? "app" : (previous?.scope ?? "app")
  };
  recordingActionId = null;
  renderSettingsModal();
}

async function saveSettings(): Promise<void> {
  if (!draftSettings) {
    return;
  }

  const validation = validateSettings(draftSettings);
  if (!validation.valid) {
    showSettingsStatus(validation.messages.join(" "), true);
    updateSaveState();
    return;
  }

  const snapshot = await window.terminalApi.saveAppSettings(draftSettings);
  settingsSnapshot = snapshot;
  appSettings = cloneSettings(snapshot.settings);
  draftSettings = cloneSettings(snapshot.settings);
  renderQuickCommands();
  renderSettingsModal();
  showSettingsNotice(snapshot.notice ?? "");

  if (snapshot.globalShortcutErrors.length > 0) {
    showSettingsStatus(snapshot.globalShortcutErrors.map((error) => error.message).join(" "), true);
    return;
  }

  showSettingsStatus("Settings saved.", false);
}

function validateSettings(settings: AppSettings): ValidationResult {
  const messages: string[] = [];
  const commandIds = new Set<string>();

  for (const command of settings.commands) {
    if (command.label.trim().length === 0) {
      messages.push("Command labels cannot be empty.");
    }

    if (command.command.trim().length === 0) {
      messages.push(`Command "${command.label || "Untitled"}" cannot be empty.`);
    }

    if (commandIds.has(command.id)) {
      messages.push(`Duplicate command id: ${command.id}.`);
    }
    commandIds.add(command.id);
  }

  const actions = getShortcutActions(settings);
  const actionLabels = new Map(actions.map((action) => [action.id, action.label]));
  const assigned = new Map<string, string>();

  for (const action of actions) {
    const binding = getBinding(settings, action);
    if (binding.scope === "disabled" || binding.accelerator.length === 0) {
      continue;
    }

    const existing = assigned.get(binding.accelerator);
    if (existing) {
      messages.push(
        `${displayAccelerator(binding.accelerator)} is already assigned to ${actionLabels.get(existing) ?? existing}.`
      );
      continue;
    }

    assigned.set(binding.accelerator, action.id);
  }

  return {
    valid: messages.length === 0,
    messages
  };
}

function updateSaveState(): void {
  if (!draftSettings) {
    saveSettingsButton.disabled = true;
    return;
  }

  const validation = validateSettings(draftSettings);
  saveSettingsButton.disabled = !validation.valid;

  if (!validation.valid) {
    showSettingsStatus(validation.messages[0] ?? "Settings are invalid.", true);
  } else if (settingsStatusElement.classList.contains("is-error")) {
    showSettingsStatus("", false);
  }
}

function getShortcutActions(settings: AppSettings): ShortcutAction[] {
  return [
    ...fixedShortcutActions,
    ...settings.commands.map((command) => ({
      id: `runCommand:${command.id}`,
      label: `Run Command: ${command.label}`,
      hint: command.command,
      defaultScope: "app" as const
    }))
  ];
}

function getBinding(settings: AppSettings, action: ShortcutAction): ShortcutBinding {
  return (
    settings.shortcuts[action.id] ?? {
      accelerator: "",
      scope: action.defaultScope
    }
  );
}

function eventToAccelerator(event: KeyboardEvent): string | null {
  if (event.key === "Meta" || event.key === "Control" || event.key === "Alt" || event.key === "Shift") {
    return null;
  }

  const key = normalizeKey(event);
  if (!key) {
    return null;
  }

  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) {
    parts.push("CmdOrCtrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }

  if (!parts.includes("CmdOrCtrl") && !parts.includes("Alt")) {
    return null;
  }

  parts.push(key);
  return parts.join("+");
}

function normalizeKey(event: KeyboardEvent): string | null {
  const codeMap: Record<string, string> = {
    BracketLeft: "[",
    BracketRight: "]",
    Minus: "-",
    Equal: "=",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`"
  };
  const codeKey = codeMap[event.code];
  if (codeKey) {
    return codeKey;
  }

  const key = event.key;

  if (key.length === 1 && /^[a-z]$/i.test(key)) {
    return key.toUpperCase();
  }

  if (key.length === 1 && /^[0-9]$/.test(key)) {
    return key;
  }

  const keyMap: Record<string, string> = {
    " ": "Space",
    Spacebar: "Space",
    Enter: "Enter",
    Tab: "Tab",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    "[": "[",
    "]": "]",
    "-": "-",
    "=": "=",
    ",": ",",
    ".": ".",
    "/": "/",
    ";": ";",
    "'": "'",
    "`": "`"
  };

  return keyMap[key] ?? null;
}

function displayAccelerator(accelerator: string): string {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return accelerator.replace("CmdOrCtrl", isMac ? "Cmd" : "Ctrl");
}

function showSettingsStatus(message: string, isError: boolean): void {
  settingsStatusElement.textContent = message;
  settingsStatusElement.classList.toggle("is-error", isError);
}

function showSettingsNotice(message: string): void {
  settingsNoticeElement.textContent = message;
  settingsNoticeElement.classList.toggle("is-visible", message.length > 0);
}

function hasUnsavedChanges(): boolean {
  return Boolean(draftSettings && appSettings && JSON.stringify(draftSettings) !== JSON.stringify(appSettings));
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    commands: settings.commands.map((command) => ({ ...command })),
    shortcuts: Object.fromEntries(
      Object.entries(settings.shortcuts).map(([actionId, binding]) => [actionId, { ...binding }])
    ),
    layout: {
      commandPanelWidth: settings.layout.commandPanelWidth
    }
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function createTextInput(value: string, placeholder: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "settings-input";
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

function scheduleFitActiveTerminal(): void {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (!activeTabId) {
      return;
    }

    const view = tabs.get(activeTabId);
    if (!view) {
      return;
    }

    view.fitAddon.fit();
    window.terminalApi.resizeTerminal({
      id: activeTabId,
      cols: view.terminal.cols,
      rows: view.terminal.rows
    });
  }, 80);
}

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }

  return element;
}
