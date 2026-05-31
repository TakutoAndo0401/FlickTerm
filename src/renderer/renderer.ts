import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import "./tauriApi";
import { createTerminalView, type RendererTerminalTab } from "./terminalTabs";
import type {
  AppLanguage,
  AppearanceSettings,
  AppSettings,
  AppSettingsSnapshot,
  CommandHistoryEntry,
  CursorStyle,
  FeatureSettings,
  QuickCommand,
  QuickCommandRunMode,
  ShortcutBinding,
  ShortcutScope,
  TerminalSessionTab,
  TerminalSessionsSnapshot,
  TerminalTab
} from "../shared/terminalTypes";

type ShortcutAction = {
  id: string;
  label: string;
  hint?: string;
  defaultScope: ShortcutScope;
};

type FixedShortcutAction = {
  id: string;
  labelKey: keyof SettingsCopy["shortcutActions"];
  defaultScope: ShortcutScope;
};

type ValidationResult = {
  valid: boolean;
  messages: string[];
};

type TerminalInputState = {
  line: string;
  cursor: number;
  dismissedSuggestionFor: string;
  suggestion: CommandHistoryEntry | null;
  suggestionOverlay: HTMLDivElement;
  historyPanel: HTMLDivElement;
  historyInput: HTMLInputElement;
  historyResults: HTMLDivElement;
  searchPanel: HTMLDivElement;
  searchInput: HTMLInputElement;
  searchStatus: HTMLDivElement;
  searchQuery: string;
  searchResultCount: number;
  searchResultIndex: number;
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
const settingsAppearancePanel = getElement("settings-appearance-panel");
const settingsFeaturesPanel = getElement("settings-features-panel");
const settingsStatusElement = getElement("settings-status");
const settingsNoticeElement = getElement("settings-notice");
const commandsEditorElement = getElement("commands-editor");
const shortcutsEditorElement = getElement("shortcuts-editor");
const appearanceEditorElement = getElement("appearance-editor");
const featuresEditorElement = getElement("features-editor");
const addCommandButton = getElement("add-command-button") as HTMLButtonElement;
const resetCommandsButton = getElement("reset-commands-button") as HTMLButtonElement;
const resetShortcutsButton = getElement("reset-shortcuts-button") as HTMLButtonElement;
const resetAppearanceButton = getElement("reset-appearance-button") as HTMLButtonElement;
const resetFeaturesButton = getElement("reset-features-button") as HTMLButtonElement;
const clearHistoryButton = getElement("clear-history-button") as HTMLButtonElement;
const checkUpdatesButton = getElement("check-updates-button") as HTMLButtonElement;
const cancelSettingsButton = getElement("cancel-settings-button") as HTMLButtonElement;
const saveSettingsButton = getElement("save-settings-button") as HTMLButtonElement;

const settingsCopy = {
  en: {
    title: "Settings",
    close: "Close",
    tabs: {
      commands: "Commands",
      shortcuts: "Shortcuts",
      appearance: "Appearance",
      features: "Features"
    },
    buttons: {
      addCommand: "Add Command",
      resetCommands: "Reset Commands",
      resetShortcuts: "Reset Shortcuts",
      resetAppearance: "Reset Appearance",
      clearHistory: "Clear History",
      resetFeatures: "Reset Features",
      checkUpdates: "Check for Updates",
      cancel: "Cancel",
      save: "Save",
      reset: "Reset",
      delete: "Delete",
      discard: "Discard",
      clear: "Clear"
    },
    headers: {
      label: "Label",
      command: "Command",
      mode: "Mode",
      action: "Action",
      scope: "Scope",
      shortcut: "Shortcut"
    },
    placeholders: {
      commandLabel: "Label",
      command: "Command"
    },
    runModes: {
      send: "Run",
      insert: "Insert",
      confirm: "Confirm"
    },
    shortcutActions: {
      toggleVisibility: "Toggle Visibility",
      openSettings: "Open Settings",
      newTab: "New Tab",
      closeTab: "Close Tab",
      nextTab: "Next Tab",
      previousTab: "Previous Tab",
      findInTerminal: "Find in Terminal",
      reopenClosedTab: "Reopen Closed Tab"
    },
    appearance: {
      language: "Language",
      languageHint: "Settings screen language",
      fontFamily: "Font family",
      fontFamilyHint: "Terminal font",
      fontSize: "Font size",
      fontSizeHint: "10-28 px",
      letterSpacing: "Letter spacing",
      letterSpacingHint: "-1 to 4 px",
      lineHeight: "Line height",
      lineHeightHint: "1.0-1.8",
      cursorStyle: "Cursor style",
      cursorStyleHint: "Terminal cursor shape"
    },
    features: {
      commandHistory: "Command History",
      commandHistoryHint: "Save executed commands for suggestions and search",
      maxHistory: "Max History",
      maxHistoryHint: "Number of unique command and directory pairs to keep",
      shellIntegration: "Shell integration",
      shellIntegrationHint: "Use zsh preexec to save the exact command that the shell executes",
      shellIntegrationSetupTitle: "Shell integration setup",
      shellIntegrationSetupHint:
        "Add this to ~/.zshrc, then open a new FlickTerm tab. If it is already added, existing tabs still need to be reopened.",
      shellIntegrationCopy: "Copy",
      shellIntegrationInstall: "Add to ~/.zshrc",
      shellIntegrationDetected: "Detected in this tab",
      shellIntegrationNotDetected: "Not detected in this tab yet",
      autosuggestions: "Autosuggestions",
      autosuggestionsHint: "Show the best matching command as ghost text",
      acceptWithTab: "Accept With Tab",
      acceptWithTabHint: "Use Tab for autosuggestions instead of passing it to the shell",
      sessionRestore: "Session Restore",
      sessionRestoreHint: "Save terminal screens and reopen closed tabs",
      enabled: "Enabled",
      disabled: "Disabled"
    },
    status: {
      commandHistoryCleared: "Command history cleared.",
      shellIntegrationCopied: "Shell integration snippet copied.",
      shellIntegrationInstalled: (path: string) => `Shell integration snippet is installed in ${path}.`,
      checkingUpdates: "Checking for updates...",
      upToDate: "FlickTerm is up to date.",
      settingsInvalid: "Settings are invalid."
    },
    errors: {
      resetCommands: "Failed to reset commands.",
      resetShortcuts: "Failed to reset shortcuts.",
      resetAppearance: "Failed to reset appearance.",
      resetFeatures: "Failed to reset features.",
      clearHistory: "Failed to clear command history.",
      copyShellIntegration: "Failed to copy shell integration snippet.",
      installShellIntegration: "Failed to update ~/.zshrc.",
      checkUpdates: "Failed to check for updates.",
      saveSettings: "Failed to save settings.",
      deleteCommand: "Failed to delete command.",
      shortcutRequiresModifier: "Shortcut must include Cmd/Ctrl or Alt.",
      emptyCommandLabel: "Command labels cannot be empty.",
      fontFamily: "Font family must be selected from the list.",
      fontSize: "Font size must be between 10 and 28.",
      letterSpacing: "Letter spacing must be between -1 and 4.",
      lineHeight: "Line height must be between 1.0 and 1.8.",
      cursorStyle: "Cursor style must be selected from the list.",
      maxHistoryInteger: "Max history must be a whole number.",
      maxHistoryRange: "Max history must be between 100 and 50000.",
      language: "Language must be selected from the list."
    },
    confirmations: {
      resetCommands: "Reset commands to defaults?",
      resetShortcuts: "Reset shortcuts to defaults?",
      resetAppearance: "Reset appearance to defaults?",
      resetFeatures: "Reset feature settings to defaults?",
      clearHistory: "Clear all command history?",
      discardUnsaved: "Discard unsaved settings changes?"
    },
    selectTab: (index: number) => `Select Tab ${index}`,
    deleteCommand: (label: string) => `Delete "${label}"?`,
    commandCannotBeEmpty: (label: string) => `Command "${label || "Untitled"}" cannot be empty.`,
    duplicateCommandId: (id: string) => `Duplicate command id: ${id}.`,
    assignedShortcut: (accelerator: string, action: string) => `${accelerator} is already assigned to ${action}.`,
    runCommandAction: (label: string) => `Run Command: ${label}`,
    installingUpdate: (version: string | null | undefined) => `Installing ${version ?? "the latest version"} and restarting...`
  },
  ja: {
    title: "設定",
    close: "閉じる",
    tabs: {
      commands: "コマンド",
      shortcuts: "ショートカット",
      appearance: "表示",
      features: "機能"
    },
    buttons: {
      addCommand: "コマンドを追加",
      resetCommands: "コマンドをリセット",
      resetShortcuts: "ショートカットをリセット",
      resetAppearance: "表示設定をリセット",
      clearHistory: "履歴を削除",
      resetFeatures: "機能設定をリセット",
      checkUpdates: "アップデートを確認",
      cancel: "キャンセル",
      save: "保存",
      reset: "リセット",
      delete: "削除",
      discard: "破棄",
      clear: "クリア"
    },
    headers: {
      label: "ラベル",
      command: "コマンド",
      mode: "モード",
      action: "アクション",
      scope: "範囲",
      shortcut: "ショートカット"
    },
    placeholders: {
      commandLabel: "ラベル",
      command: "コマンド"
    },
    runModes: {
      send: "実行",
      insert: "入力",
      confirm: "確認"
    },
    shortcutActions: {
      toggleVisibility: "表示を切り替え",
      openSettings: "設定を開く",
      newTab: "新しいタブ",
      closeTab: "タブを閉じる",
      nextTab: "次のタブ",
      previousTab: "前のタブ",
      findInTerminal: "ターミナル内を検索",
      reopenClosedTab: "閉じたタブを復元"
    },
    appearance: {
      language: "言語",
      languageHint: "設定画面の表示言語",
      fontFamily: "フォント",
      fontFamilyHint: "ターミナルのフォント",
      fontSize: "フォントサイズ",
      fontSizeHint: "10-28 px",
      letterSpacing: "文字間隔",
      letterSpacingHint: "-1 から 4 px",
      lineHeight: "行の高さ",
      lineHeightHint: "1.0-1.8",
      cursorStyle: "カーソル形状",
      cursorStyleHint: "ターミナルのカーソル形状"
    },
    features: {
      commandHistory: "コマンド履歴",
      commandHistoryHint: "候補表示と検索のために実行済みコマンドを保存",
      maxHistory: "最大履歴数",
      maxHistoryHint: "保存するコマンドとディレクトリの組み合わせ数",
      shellIntegration: "シェル連携",
      shellIntegrationHint: "zsh の preexec で、シェルが実行する確定済みコマンドを保存",
      shellIntegrationSetupTitle: "シェル連携の設定",
      shellIntegrationSetupHint:
        "この内容を ~/.zshrc に追加してから、新しい FlickTerm タブを開いてください。既に追加済みの場合も、現在開いているタブには反映されません。",
      shellIntegrationCopy: "コピー",
      shellIntegrationInstall: "~/.zshrc に追加",
      shellIntegrationDetected: "このタブで検出済み",
      shellIntegrationNotDetected: "このタブでは未検出",
      autosuggestions: "自動候補",
      autosuggestionsHint: "最も一致するコマンドを薄い文字で表示",
      acceptWithTab: "Tab で候補を採用",
      acceptWithTabHint: "Tab をシェルへ渡さず自動候補の採用に使う",
      sessionRestore: "セッション復元",
      sessionRestoreHint: "ターミナル画面を保存し、閉じたタブを復元",
      enabled: "有効",
      disabled: "無効"
    },
    status: {
      commandHistoryCleared: "コマンド履歴を削除しました。",
      shellIntegrationCopied: "シェル連携の snippet をコピーしました。",
      shellIntegrationInstalled: (path: string) => `シェル連携の snippet を ${path} に追加しました。`,
      checkingUpdates: "アップデートを確認しています...",
      upToDate: "FlickTerm は最新です。",
      settingsInvalid: "設定が正しくありません。"
    },
    errors: {
      resetCommands: "コマンドをリセットできませんでした。",
      resetShortcuts: "ショートカットをリセットできませんでした。",
      resetAppearance: "表示設定をリセットできませんでした。",
      resetFeatures: "機能設定をリセットできませんでした。",
      clearHistory: "コマンド履歴を削除できませんでした。",
      copyShellIntegration: "シェル連携の snippet をコピーできませんでした。",
      installShellIntegration: "~/.zshrc を更新できませんでした。",
      checkUpdates: "アップデートを確認できませんでした。",
      saveSettings: "設定を保存できませんでした。",
      deleteCommand: "コマンドを削除できませんでした。",
      shortcutRequiresModifier: "ショートカットには Cmd/Ctrl または Alt が必要です。",
      emptyCommandLabel: "コマンドのラベルは空にできません。",
      fontFamily: "フォントは一覧から選択してください。",
      fontSize: "フォントサイズは 10 から 28 の間にしてください。",
      letterSpacing: "文字間隔は -1 から 4 の間にしてください。",
      lineHeight: "行の高さは 1.0 から 1.8 の間にしてください。",
      cursorStyle: "カーソル形状は一覧から選択してください。",
      maxHistoryInteger: "最大履歴数は整数にしてください。",
      maxHistoryRange: "最大履歴数は 100 から 50000 の間にしてください。",
      language: "言語は一覧から選択してください。"
    },
    confirmations: {
      resetCommands: "コマンドを初期設定に戻しますか？",
      resetShortcuts: "ショートカットを初期設定に戻しますか？",
      resetAppearance: "表示設定を初期設定に戻しますか？",
      resetFeatures: "機能設定を初期設定に戻しますか？",
      clearHistory: "すべてのコマンド履歴を削除しますか？",
      discardUnsaved: "未保存の設定変更を破棄しますか？"
    },
    selectTab: (index: number) => `タブ ${index} を選択`,
    deleteCommand: (label: string) => `「${label}」を削除しますか？`,
    commandCannotBeEmpty: (label: string) => `コマンド「${label || "無題"}」は空にできません。`,
    duplicateCommandId: (id: string) => `コマンド ID が重複しています: ${id}`,
    assignedShortcut: (accelerator: string, action: string) => `${accelerator} はすでに ${action} に割り当てられています。`,
    runCommandAction: (label: string) => `コマンドを実行: ${label}`,
    installingUpdate: (version: string | null | undefined) => `${version ?? "最新バージョン"} をインストールして再起動しています...`
  }
} as const;

type SettingsCopy = (typeof settingsCopy)[AppLanguage];

const languageOptions = [
  { label: "English", value: "en" },
  { label: "日本語", value: "ja" }
] as const;
const languageValues = new Set<AppLanguage>(languageOptions.map((option) => option.value));

const fixedShortcutActions: FixedShortcutAction[] = [
  { id: "toggleVisibility", labelKey: "toggleVisibility", defaultScope: "global" },
  { id: "openSettings", labelKey: "openSettings", defaultScope: "app" },
  { id: "newTab", labelKey: "newTab", defaultScope: "app" },
  { id: "closeTab", labelKey: "closeTab", defaultScope: "app" },
  { id: "nextTab", labelKey: "nextTab", defaultScope: "app" },
  { id: "previousTab", labelKey: "previousTab", defaultScope: "app" },
  { id: "findInTerminal", labelKey: "findInTerminal", defaultScope: "app" },
  { id: "reopenClosedTab", labelKey: "reopenClosedTab", defaultScope: "app" },
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `selectTab:${index + 1}`,
    labelKey: "newTab" as const,
    defaultScope: "app" as const
  }))
];

const commandPanelWidthDefault = 168;
const commandPanelWidthMin = 120;
const commandPanelWidthMax = 360;
const commandPanelKeyboardStep = 10;
const historySearchResultLimit = 8;
const sessionSerializeScrollback = 1000;
const sessionSaveDebounceMs = 2000;
const closedTabsLimit = 10;
const fontFamilyOptions = [
  { label: "Menlo", value: "Menlo, Monaco, Consolas, 'Courier New', monospace" },
  { label: "Monaco", value: "Monaco, Menlo, Consolas, 'Courier New', monospace" },
  { label: "Courier New", value: "'Courier New', monospace" }
] as const;
const fontFamilyValues = new Set<string>(fontFamilyOptions.map((option) => option.value));
const cursorStyleOptions = [
  { label: "Block", value: "block" },
  { label: "Bar", value: "bar" },
  { label: "Underline", value: "underline" }
] as const;
const cursorStyleValues = new Set<string>(cursorStyleOptions.map((option) => option.value));

const tabs = new Map<string, RendererTerminalTab>();
const inputStates = new Map<string, TerminalInputState>();
const pendingTerminalData = new Map<string, Uint8Array[]>();
let activeTabId: string | null = null;
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
let settingsTab: "commands" | "shortcuts" | "appearance" | "features" = "commands";
let recordingActionId: string | null = null;
let isSavingSettings = false;
let commandHistory: CommandHistoryEntry[] = [];
let shellIntegrationSnippet = "";
const shellIntegrationDetectedTabs = new Set<string>();
let activeHistorySearch:
  | {
      tabId: string;
      query: string;
      interactionMode: "keyboard" | "mouse";
      selectedIndex: number;
      results: CommandHistoryEntry[];
    }
  | null = null;
let activeTerminalSearchTabId: string | null = null;
let sessionSaveTimer: number | undefined;
let sessionSaveSignature = "";
let closedSessionTabs: TerminalSessionTab[] = [];
let isRestoringSessions = false;
let activeSettingsConfirmation:
  | {
      resolve: (confirmed: boolean) => void;
      element: HTMLElement;
    }
  | null = null;
let activeCommandConfirmation:
  | {
      resolve: (confirmed: boolean) => void;
      element: HTMLElement;
    }
  | null = null;

window.terminalApi.onTerminalData(({ id, data }) => {
  const chunk = new Uint8Array(data);
  const view = tabs.get(id);
  if (!view) {
    const pending = pendingTerminalData.get(id) ?? [];
    pending.push(chunk);
    pendingTerminalData.set(id, pending);
    return;
  }

  view.terminal.write(chunk, () => {
    scheduleSuggestionUpdate(id);
    markSessionsDirty();
  });
});

window.terminalApi.onCommandHistoryUpdated((entries) => {
  commandHistory = entries;
  updateActiveSuggestion();
});

window.terminalApi.onShellIntegrationStatus(({ id, detected }) => {
  if (detected) {
    shellIntegrationDetectedTabs.add(id);
  } else {
    shellIntegrationDetectedTabs.delete(id);
  }
  if (settingsTab === "features" && isSettingsOpen()) {
    renderFeaturesEditor();
  }
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

    if (event.key === "Escape" && activeCommandConfirmation) {
      event.preventDefault();
      resolveCommandConfirmation(false);
      return;
    }

    if (event.key === "Escape" && isSettingsOpen()) {
      event.preventDefault();
      if (activeSettingsConfirmation) {
        resolveSettingsConfirmation(false);
      } else {
        closeSettingsWithConfirmation().catch((error) => {
          console.error("Failed to close settings", error);
        });
      }
      return;
    }

    if (isSettingsOpen()) {
      return;
    }

    if (activeHistorySearch) {
      handleHistorySearchKeydown(event);
      return;
    }

    if (activeTerminalSearchTabId) {
      handleTerminalSearchKeydown(event);
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
  closeSettingsWithConfirmation().catch((error) => {
    console.error("Failed to close settings", error);
  });
});

settingsOverlay.addEventListener("click", (event) => {
  if (event.target === settingsOverlay) {
    closeSettingsWithConfirmation().catch((error) => {
      console.error("Failed to close settings", error);
    });
  }
});

for (const tabButton of settingsTabs) {
  tabButton.addEventListener("click", () => {
    const tab = tabButton.dataset.settingsTab;
    if (tab === "commands" || tab === "shortcuts" || tab === "appearance" || tab === "features") {
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
    label: settingsLanguage() === "ja" ? "新しいコマンド" : "New command",
    command: "",
    runMode: "send"
  });
  renderSettingsModal();
});

resetCommandsButton.addEventListener("click", () => {
  if (!draftSettings || !settingsSnapshot) {
    return;
  }

  confirmSettingsAction(copy().confirmations.resetCommands, copy().buttons.reset)
    .then((confirmed) => {
      if (!confirmed || !draftSettings || !settingsSnapshot) {
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
    })
    .catch((error) => {
      showSettingsStatus(error instanceof Error ? error.message : copy().errors.resetCommands, true);
    });
});

resetShortcutsButton.addEventListener("click", () => {
  if (!draftSettings || !settingsSnapshot) {
    return;
  }

  confirmSettingsAction(copy().confirmations.resetShortcuts, copy().buttons.reset)
    .then((confirmed) => {
      if (!confirmed || !draftSettings || !settingsSnapshot) {
        return;
      }

      draftSettings.shortcuts = cloneSettings(settingsSnapshot.defaults).shortcuts;
      renderSettingsModal();
    })
    .catch((error) => {
      showSettingsStatus(error instanceof Error ? error.message : copy().errors.resetShortcuts, true);
    });
});

resetAppearanceButton.addEventListener("click", () => {
  if (!draftSettings || !settingsSnapshot) {
    return;
  }

  confirmSettingsAction(copy().confirmations.resetAppearance, copy().buttons.reset)
    .then((confirmed) => {
      if (!confirmed || !draftSettings || !settingsSnapshot) {
        return;
      }

      draftSettings.appearance = { ...settingsSnapshot.defaults.appearance };
      renderSettingsModal();
    })
    .catch((error) => {
      showSettingsStatus(error instanceof Error ? error.message : copy().errors.resetAppearance, true);
    });
});

resetFeaturesButton.addEventListener("click", () => {
  if (!draftSettings || !settingsSnapshot) {
    return;
  }

  confirmSettingsAction(copy().confirmations.resetFeatures, copy().buttons.reset)
    .then((confirmed) => {
      if (!confirmed || !draftSettings || !settingsSnapshot) {
        return;
      }

      draftSettings.features = cloneFeatures(settingsSnapshot.defaults.features);
      renderSettingsModal();
    })
    .catch((error) => {
      showSettingsStatus(error instanceof Error ? error.message : copy().errors.resetFeatures, true);
    });
});

clearHistoryButton.addEventListener("click", () => {
  confirmSettingsAction(copy().confirmations.clearHistory, copy().buttons.delete)
    .then((confirmed) => {
      if (!confirmed) {
        return;
      }

      return window.terminalApi.clearCommandHistory().then((entries) => {
        commandHistory = entries;
        updateActiveSuggestion();
        showSettingsStatus(copy().status.commandHistoryCleared);
      });
    })
    .catch((error) => {
      showSettingsStatus(error instanceof Error ? error.message : copy().errors.clearHistory, true);
    });
});

checkUpdatesButton.addEventListener("click", () => {
  checkForUpdates().catch((error) => {
    showSettingsStatus(error instanceof Error ? error.message : copy().errors.checkUpdates, true);
  });
});

cancelSettingsButton.addEventListener("click", () => {
  closeSettingsWithConfirmation().catch((error) => {
    console.error("Failed to close settings", error);
  });
});

saveSettingsButton.addEventListener("click", () => {
  saveSettings().catch((error) => {
    showSettingsStatus(error instanceof Error ? error.message : copy().errors.saveSettings, true);
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
  shellIntegrationSnippet = await window.terminalApi.getShellIntegrationZshrcSnippet();
  commandHistory = await window.terminalApi.listCommandHistory();
  renderQuickCommands();
  await restoreTerminalSessions();
}

window.addEventListener("beforeunload", () => {
  void saveTerminalSessionsNow();
});

async function restoreTerminalSessions(): Promise<void> {
  if (!appSettings?.features.sessionRestore.enabled) {
    await window.terminalApi.clearTerminalSessions();
    await createTab();
    return;
  }

  const snapshot = await window.terminalApi.getTerminalSessions();
  closedSessionTabs = snapshot.closedTabs.slice(0, closedTabsLimit);

  if (snapshot.tabs.length === 0) {
    await createTab();
    return;
  }

  isRestoringSessions = true;
  try {
    for (const tab of snapshot.tabs) {
      await createTabFromSession(tab);
    }

    const activeId = snapshot.activeTabId && tabs.has(snapshot.activeTabId) ? snapshot.activeTabId : snapshot.tabs[0]?.id;
    if (activeId) {
      activateTab(activeId);
    }
    sessionSaveSignature = getTerminalSessionsSignature(buildTerminalSessionsSnapshot());
  } finally {
    isRestoringSessions = false;
  }
}

async function reloadSettings(): Promise<void> {
  settingsSnapshot = await window.terminalApi.getAppSettings();
  appSettings = cloneSettings(settingsSnapshot.settings);
  setCommandPanelWidth(appSettings.layout.commandPanelWidth);
  showSettingsNotice(settingsSnapshot.notice ?? "");
}

async function createTab(): Promise<void> {
  const id = `terminal-${crypto.randomUUID()}`;
  const title = nextTerminalTitle();
  const response = await window.terminalApi.createTerminal({
    id,
    title,
    cols: 80,
    rows: 24
  });

  attachTerminal(response.tab);
  activateTab(response.tab.id);
  markSessionsDirty();
}

async function createTabFromSession(session: TerminalSessionTab): Promise<string> {
  const id = tabs.has(session.id) ? `terminal-${crypto.randomUUID()}` : session.id;
  const response = await window.terminalApi.createTerminal({
    id,
    title: session.title,
    cols: session.cols,
    rows: session.rows
  });

  attachTerminal(response.tab, { deferPendingData: true });
  const view = tabs.get(response.tab.id);
  if (view && session.serialized.length > 0) {
    const restored = prepareSerializedSessionForRestore(session.serialized);
    if (restored.length > 0) {
      view.terminal.write(restored);
    }
  }
  flushPendingTerminalData(response.tab.id);
  return response.tab.id;
}

function nextTerminalTitle(): string {
  const usedNumbers = new Set<number>();

  for (const view of tabs.values()) {
    const match = /^zsh ([1-9]\d*)$/.exec(view.metadata.title);
    if (match) {
      usedNumbers.add(Number(match[1]));
    }
  }

  let candidate = 1;
  while (usedNumbers.has(candidate)) {
    candidate += 1;
  }

  return `zsh ${candidate}`;
}

function attachTerminal(tab: TerminalTab, options: { deferPendingData?: boolean } = {}): void {
  const view = createTerminalView(tab, getActiveAppearance());

  tabs.set(tab.id, view);
  terminalHost.append(view.element);
  view.terminal.open(view.element);
  inputStates.set(tab.id, createTerminalInputState(view));
  if (!options.deferPendingData) {
    flushPendingTerminalData(tab.id);
  }
  view.terminal.attachCustomKeyEventHandler((event) => handleTerminalKeyEvent(tab.id, event));
  view.terminal.onData((data) => {
    if (handleTerminalInputData(tab.id, data)) {
      return;
    }
    window.terminalApi.writeTerminal({ id: tab.id, data });
  });
  view.terminal.onResize(({ cols, rows }) => {
    window.terminalApi.resizeTerminal({ id: tab.id, cols, rows });
    markSessionsDirty();
  });

  view.searchAddon.onDidChangeResults(({ resultCount, resultIndex }) => {
    const state = inputStates.get(tab.id);
    if (!state) {
      return;
    }
    state.searchResultCount = resultCount;
    state.searchResultIndex = resultIndex;
    renderTerminalSearchStatus(state);
  });

  renderTabs();
}

function flushPendingTerminalData(tabId: string): void {
  const view = tabs.get(tabId);
  const pending = pendingTerminalData.get(tabId);
  if (!view || !pending) {
    return;
  }

  pendingTerminalData.delete(tabId);
  for (const chunk of pending) {
    view.terminal.write(chunk);
  }
  markSessionsDirty();
}

function activateTab(id: string): void {
  if (!tabs.has(id)) {
    return;
  }

  if (activeTerminalSearchTabId && activeTerminalSearchTabId !== id) {
    closeTerminalSearch(activeTerminalSearchTabId);
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
  markSessionsDirty();
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

  rememberClosedTab(view);
  if (activeTerminalSearchTabId === id) {
    closeTerminalSearch(id);
  }
  window.terminalApi.killTerminal({ id });
  view.terminal.dispose();
  view.element.remove();
  tabs.delete(id);
  inputStates.delete(id);
  shellIntegrationDetectedTabs.delete(id);

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
  markSessionsDirty();
}

async function reopenClosedTab(): Promise<void> {
  if (!appSettings?.features.sessionRestore.enabled || closedSessionTabs.length === 0) {
    return;
  }

  const [session, ...rest] = closedSessionTabs;
  if (!session) {
    return;
  }

  closedSessionTabs = rest;
  const restoredId = await createTabFromSession(session);
  activateTab(restoredId);
  markSessionsDirty();
}

function rememberClosedTab(view: RendererTerminalTab): void {
  if (!appSettings?.features.sessionRestore.enabled || isRestoringSessions) {
    return;
  }

  closedSessionTabs = [serializeSessionTab(view), ...closedSessionTabs].slice(0, closedTabsLimit);
}

function markSessionsDirty(): void {
  if (isRestoringSessions || !appSettings?.features.sessionRestore.enabled) {
    return;
  }

  window.clearTimeout(sessionSaveTimer);
  sessionSaveTimer = window.setTimeout(() => {
    saveTerminalSessionsNow().catch((error) => {
      console.warn("Failed to save terminal sessions", error);
    });
  }, sessionSaveDebounceMs);
}

async function saveTerminalSessionsNow(): Promise<void> {
  if (!appSettings?.features.sessionRestore.enabled) {
    return;
  }

  const snapshot = buildTerminalSessionsSnapshot();
  const signature = getTerminalSessionsSignature(snapshot);
  if (signature === sessionSaveSignature) {
    return;
  }

  await window.terminalApi.saveTerminalSessions(snapshot);
  sessionSaveSignature = signature;
}

function buildTerminalSessionsSnapshot(): TerminalSessionsSnapshot {
  return {
    version: 1,
    activeTabId: activeTabId ?? undefined,
    tabs: Array.from(tabs.values()).map(serializeSessionTab),
    closedTabs: closedSessionTabs.slice(0, closedTabsLimit)
  };
}

function serializeSessionTab(view: RendererTerminalTab): TerminalSessionTab {
  return {
    id: view.metadata.id,
    title: view.metadata.title,
    shell: view.metadata.shell,
    cwd: view.metadata.cwd,
    cols: view.terminal.cols,
    rows: view.terminal.rows,
    serialized: view.serializeAddon.serialize({
      scrollback: sessionSerializeScrollback,
      excludeAltBuffer: true
    }),
    updatedAt: String(Date.now())
  };
}

function prepareSerializedSessionForRestore(serialized: string): string {
  const lines = serialized
    .replaceAll(/\x1b\[\?2004[hl]/g, "")
    .split(/\r\n|\n|\r/);

  while (lines.length > 0 && isRestoredPromptOnlyLine(lines[lines.length - 1] ?? "")) {
    lines.pop();
  }

  const restored = lines.join("\r\n");
  if (restored.length === 0) {
    return "";
  }

  return /[\r\n]$/.test(restored) ? restored : `${restored}\r\n`;
}

function isRestoredPromptOnlyLine(line: string): boolean {
  const plain = stripTerminalControlSequences(line).trimEnd();
  if (plain.length === 0) {
    return true;
  }
  if (/^[%#$>]$/.test(plain)) {
    return true;
  }

  return /^[^\s@]+@[^\s]+ .+ [%#$>](?:\s*[%#$>])?$/.test(plain);
}

function stripTerminalControlSequences(value: string): string {
  return value
    .replaceAll(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replaceAll(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll(/\x1b./g, "");
}

function getTerminalSessionsSignature(snapshot: TerminalSessionsSnapshot): string {
  return JSON.stringify({
    activeTabId: snapshot.activeTabId,
    tabs: snapshot.tabs.map(({ updatedAt: _updatedAt, ...tab }) => tab),
    closedTabs: snapshot.closedTabs.map(({ updatedAt: _updatedAt, ...tab }) => tab)
  });
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
    runCommand(command).catch((error) => {
      console.error("Failed to run command", error);
    });
  });

  return button;
}

async function runCommand(command: QuickCommand): Promise<void> {
  if (!activeTabId) {
    return;
  }

  if (command.runMode === "confirm" && !(await confirmCommandAction(`Run this command?\n${command.command}`, "Run"))) {
    return;
  }

  if (command.runMode !== "insert") {
    recordCommandIfEligible(activeTabId, command.command).catch((error) => {
      console.warn("Failed to record command history", error);
    });
    const state = inputStates.get(activeTabId);
    if (state) {
      state.line = "";
      state.cursor = 0;
      state.dismissedSuggestionFor = "";
      state.suggestion = null;
      hideSuggestion(state);
    }
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

  if (actionId === "openSettings") {
    openSettings();
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

  if (actionId === "findInTerminal") {
    openTerminalSearch();
    return;
  }

  if (actionId === "reopenClosedTab") {
    reopenClosedTab().catch((error) => {
      console.error("Failed to reopen closed tab", error);
    });
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
      runCommand(command).catch((error) => {
        console.error("Failed to run command", error);
      });
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

async function closeSettingsWithConfirmation(): Promise<void> {
  if (!isSettingsOpen()) {
    return;
  }

  if (hasUnsavedChanges() && !(await confirmSettingsAction(copy().confirmations.discardUnsaved, copy().buttons.discard))) {
    return;
  }

  closeSettings();
}

function closeSettings(): void {
  resolveSettingsConfirmation(false);
  recordingActionId = null;
  draftSettings = null;
  isSavingSettings = false;
  settingsOverlay.classList.remove("is-open");
  settingsOverlay.setAttribute("aria-hidden", "true");
}

function isSettingsOpen(): boolean {
  return settingsOverlay.classList.contains("is-open");
}

function settingsLanguage(): AppLanguage {
  return draftSettings?.language ?? appSettings?.language ?? "en";
}

function copy(): SettingsCopy {
  return settingsCopy[settingsLanguage()];
}

function renderSettingsModal(): void {
  if (!draftSettings) {
    return;
  }

  renderSettingsCopy();

  for (const tabButton of settingsTabs) {
    const isActive = tabButton.dataset.settingsTab === settingsTab;
    tabButton.classList.toggle("is-active", isActive);
    tabButton.setAttribute("aria-selected", String(isActive));
  }

  settingsCommandsPanel.classList.toggle("is-active", settingsTab === "commands");
  settingsShortcutsPanel.classList.toggle("is-active", settingsTab === "shortcuts");
  settingsAppearancePanel.classList.toggle("is-active", settingsTab === "appearance");
  settingsFeaturesPanel.classList.toggle("is-active", settingsTab === "features");
  renderCommandEditor();
  renderShortcutEditor();
  renderAppearanceEditor();
  renderFeaturesEditor();
  updateSaveState();
}

function renderSettingsCopy(): void {
  const text = copy();
  const title = document.getElementById("settings-title");
  if (title) {
    title.textContent = text.title;
  }
  settingsCloseButton.title = text.close;

  for (const tabButton of settingsTabs) {
    const tab = tabButton.dataset.settingsTab;
    if (tab === "commands" || tab === "shortcuts" || tab === "appearance" || tab === "features") {
      tabButton.textContent = text.tabs[tab];
    }
  }

  addCommandButton.textContent = text.buttons.addCommand;
  resetCommandsButton.textContent = text.buttons.resetCommands;
  resetShortcutsButton.textContent = text.buttons.resetShortcuts;
  resetAppearanceButton.textContent = text.buttons.resetAppearance;
  clearHistoryButton.textContent = text.buttons.clearHistory;
  resetFeaturesButton.textContent = text.buttons.resetFeatures;
  checkUpdatesButton.textContent = text.buttons.checkUpdates;
  cancelSettingsButton.textContent = text.buttons.cancel;
  saveSettingsButton.textContent = text.buttons.save;

  const commandHeader = Array.from(settingsCommandsPanel.querySelectorAll(".command-editor-header span"));
  commandHeader[0]?.replaceChildren(text.headers.label);
  commandHeader[1]?.replaceChildren(text.headers.command);
  commandHeader[2]?.replaceChildren(text.headers.mode);

  const shortcutHeader = Array.from(settingsShortcutsPanel.querySelectorAll(".shortcut-editor-header span"));
  shortcutHeader[0]?.replaceChildren(text.headers.action);
  shortcutHeader[1]?.replaceChildren(text.headers.scope);
  shortcutHeader[2]?.replaceChildren(text.headers.shortcut);
}

function renderCommandEditor(): void {
  if (!draftSettings) {
    return;
  }

  const text = copy();
  commandsEditorElement.replaceChildren();

  for (const command of draftSettings.commands) {
    const row = document.createElement("div");
    row.className = "command-editor-row";

    const labelInput = createTextInput(command.label, text.placeholders.commandLabel);
    labelInput.addEventListener("input", () => {
      command.label = labelInput.value;
      renderShortcutEditor();
      updateSaveState();
    });

    const commandInput = createTextInput(command.command, text.placeholders.command);
    commandInput.addEventListener("input", () => {
      command.command = commandInput.value;
      updateSaveState();
    });

    const runModeSelect = document.createElement("select");
    runModeSelect.className = "settings-select";
    for (const [value, label] of [
      ["send", text.runModes.send],
      ["insert", text.runModes.insert],
      ["confirm", text.runModes.confirm]
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
    deleteButton.textContent = text.buttons.delete;
    deleteButton.addEventListener("click", () => {
      if (!draftSettings) {
        return;
      }

      confirmSettingsAction(copy().deleteCommand(command.label), copy().buttons.delete)
        .then((confirmed) => {
          if (!confirmed || !draftSettings) {
            return;
          }

          draftSettings.commands = draftSettings.commands.filter((item) => item.id !== command.id);
          delete draftSettings.shortcuts[`runCommand:${command.id}`];
          renderSettingsModal();
        })
        .catch((error) => {
          showSettingsStatus(error instanceof Error ? error.message : copy().errors.deleteCommand, true);
        });
    });

    row.append(labelInput, commandInput, runModeSelect, deleteButton);
    commandsEditorElement.append(row);
  }
}

function renderShortcutEditor(): void {
  if (!draftSettings) {
    return;
  }

  const text = copy();
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
        ? settingsLanguage() === "ja"
          ? "キーを押してください..."
          : "Press keys..."
        : binding.accelerator
          ? displayAccelerator(binding.accelerator)
          : settingsLanguage() === "ja"
            ? "未割り当て"
            : "Unassigned";
    recordButton.addEventListener("click", () => {
      recordingActionId = action.id;
      renderShortcutEditor();
    });

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "settings-secondary-button";
    clearButton.textContent = text.buttons.clear;
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

function renderAppearanceEditor(): void {
  if (!draftSettings) {
    return;
  }

  const text = copy();
  appearanceEditorElement.replaceChildren(
    createLanguageSelectRow(text.appearance.language, draftSettings.language, text.appearance.languageHint),
    createAppearanceSelectRow(text.appearance.fontFamily, draftSettings.appearance.fontFamily, text.appearance.fontFamilyHint),
    createAppearanceNumberRow(
      text.appearance.fontSize,
      "fontSize",
      draftSettings.appearance.fontSize,
      10,
      28,
      1,
      text.appearance.fontSizeHint
    ),
    createAppearanceNumberRow(
      text.appearance.letterSpacing,
      "letterSpacing",
      draftSettings.appearance.letterSpacing,
      -1,
      4,
      0.1,
      text.appearance.letterSpacingHint
    ),
    createAppearanceNumberRow(
      text.appearance.lineHeight,
      "lineHeight",
      draftSettings.appearance.lineHeight,
      1,
      1.8,
      0.05,
      text.appearance.lineHeightHint
    ),
    createAppearanceCursorStyleRow(
      text.appearance.cursorStyle,
      draftSettings.appearance.cursorStyle,
      text.appearance.cursorStyleHint
    )
  );
}

function renderFeaturesEditor(): void {
  if (!draftSettings) {
    return;
  }

  const text = copy();
  const shellIntegrationEnabled =
    draftSettings.features.commandHistory.enabled && draftSettings.features.commandHistory.shellIntegration;
  featuresEditorElement.replaceChildren(
    createFeatureCheckboxRow(
      text.features.commandHistory,
      text.features.commandHistoryHint,
      draftSettings.features.commandHistory.enabled,
      (checked) => {
        if (!draftSettings) {
          return;
        }
        draftSettings.features.commandHistory.enabled = checked;
        renderFeaturesEditor();
      }
    ),
    createFeatureNumberRow(
      text.features.maxHistory,
      text.features.maxHistoryHint,
      draftSettings.features.commandHistory.maxEntries,
      100,
      50000,
      100
    ),
    createFeatureCheckboxRow(
      text.features.shellIntegration,
      text.features.shellIntegrationHint,
      draftSettings.features.commandHistory.shellIntegration,
      (checked) => {
        if (!draftSettings) {
          return;
        }
        draftSettings.features.commandHistory.shellIntegration = checked;
        renderFeaturesEditor();
      }
    ),
    ...(shellIntegrationEnabled ? [createShellIntegrationSetup()] : []),
    createFeatureCheckboxRow(
      text.features.autosuggestions,
      text.features.autosuggestionsHint,
      draftSettings.features.autosuggestions.enabled,
      (checked) => {
        if (!draftSettings) {
          return;
        }
        draftSettings.features.autosuggestions.enabled = checked;
      }
    ),
    createFeatureCheckboxRow(
      text.features.acceptWithTab,
      text.features.acceptWithTabHint,
      draftSettings.features.autosuggestions.acceptWithTab,
      (checked) => {
        if (!draftSettings) {
          return;
        }
        draftSettings.features.autosuggestions.acceptWithTab = checked;
      }
    ),
    createFeatureCheckboxRow(
      text.features.sessionRestore,
      text.features.sessionRestoreHint,
      draftSettings.features.sessionRestore.enabled,
      (checked) => {
        if (!draftSettings) {
          return;
        }
        draftSettings.features.sessionRestore.enabled = checked;
      }
    )
  );
}

function createFeatureCheckboxRow(
  labelText: string,
  hintText: string,
  checked: boolean,
  onChange: (checked: boolean) => void
): HTMLDivElement {
  const label = document.createElement("label");
  label.className = "settings-checkbox-label";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => {
    onChange(input.checked);
    updateSaveState();
  });
  const text = document.createElement("span");
  text.textContent = checked ? copy().features.enabled : copy().features.disabled;
  input.addEventListener("change", () => {
    text.textContent = input.checked ? copy().features.enabled : copy().features.disabled;
  });
  label.append(input, text);

  return createFeatureRow(labelText, hintText, label);
}

function createShellIntegrationSetup(): HTMLDivElement {
  const text = copy();
  const row = document.createElement("div");
  row.className = "shell-integration-setup";

  const header = document.createElement("div");
  header.className = "shell-integration-header";

  const title = document.createElement("div");
  title.className = "shell-integration-title";
  title.textContent = text.features.shellIntegrationSetupTitle;

  const detected = document.createElement("div");
  const isDetected = activeTabId ? shellIntegrationDetectedTabs.has(activeTabId) : false;
  detected.className = `shell-integration-status ${isDetected ? "is-detected" : ""}`;
  detected.textContent = isDetected ? text.features.shellIntegrationDetected : text.features.shellIntegrationNotDetected;
  header.append(title, detected);

  const hint = document.createElement("div");
  hint.className = "shell-integration-hint";
  hint.textContent = text.features.shellIntegrationSetupHint;

  const snippet = document.createElement("pre");
  snippet.className = "shell-integration-snippet";
  snippet.textContent = shellIntegrationSnippet;

  const actions = document.createElement("div");
  actions.className = "shell-integration-actions";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "settings-secondary-button";
  copyButton.textContent = text.features.shellIntegrationCopy;
  copyButton.addEventListener("click", () => {
    navigator.clipboard
      .writeText(shellIntegrationSnippet)
      .then(() => {
        showSettingsStatus(copy().status.shellIntegrationCopied);
      })
      .catch((error) => {
        showSettingsStatus(error instanceof Error ? error.message : copy().errors.copyShellIntegration, true);
      });
  });

  const installButton = document.createElement("button");
  installButton.type = "button";
  installButton.className = "settings-primary-button";
  installButton.textContent = text.features.shellIntegrationInstall;
  installButton.addEventListener("click", () => {
    window.terminalApi
      .installShellIntegrationZshrc()
      .then((path) => {
        showSettingsStatus(copy().status.shellIntegrationInstalled(path));
      })
      .catch((error) => {
        showSettingsStatus(error instanceof Error ? error.message : copy().errors.installShellIntegration, true);
      });
  });

  actions.append(copyButton, installButton);
  row.append(header, hint, snippet, actions);
  return row;
}

function createFeatureNumberRow(
  labelText: string,
  hintText: string,
  value: number,
  min: number,
  max: number,
  step: number
): HTMLDivElement {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "settings-input";
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.addEventListener("input", () => {
    if (!draftSettings) {
      return;
    }

    const nextValue = Number(input.value);
    if (Number.isFinite(nextValue)) {
      draftSettings.features.commandHistory.maxEntries = clamp(nextValue, min, max);
    }
    updateSaveState();
  });

  return createFeatureRow(labelText, hintText, input);
}

function createFeatureRow(labelText: string, hintText: string, control: HTMLElement): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "features-editor-row";

  const label = document.createElement("div");
  label.className = "features-editor-label";
  label.textContent = labelText;
  const hint = document.createElement("div");
  hint.className = "features-editor-hint";
  hint.textContent = hintText;
  const text = document.createElement("div");
  text.append(label, hint);

  row.append(text, control);
  return row;
}

function createLanguageSelectRow(labelText: string, value: AppLanguage, hintText: string): HTMLDivElement {
  const select = document.createElement("select");
  select.className = "settings-select";
  for (const optionValue of languageOptions) {
    const option = document.createElement("option");
    option.value = optionValue.value;
    option.textContent = optionValue.label;
    select.append(option);
  }
  select.value = languageValues.has(value) ? value : "en";
  select.addEventListener("change", () => {
    if (!draftSettings) {
      return;
    }

    draftSettings.language = languageValues.has(select.value as AppLanguage) ? (select.value as AppLanguage) : "en";
    renderSettingsModal();
  });

  return createAppearanceRow(labelText, hintText, select);
}

function createAppearanceSelectRow(labelText: string, value: string, hintText: string): HTMLDivElement {
  const select = document.createElement("select");
  select.className = "settings-select";
  for (const optionValue of fontFamilyOptions) {
    const option = document.createElement("option");
    option.value = optionValue.value;
    option.textContent = optionValue.label;
    select.append(option);
  }
  select.value = fontFamilyValues.has(value) ? value : fontFamilyOptions[0].value;
  select.addEventListener("change", () => {
    if (!draftSettings) {
      return;
    }

    draftSettings.appearance.fontFamily = select.value;
    updateSaveState();
  });

  return createAppearanceRow(labelText, hintText, select);
}

function createAppearanceCursorStyleRow(labelText: string, value: CursorStyle, hintText: string): HTMLDivElement {
  const select = document.createElement("select");
  select.className = "settings-select";
  for (const optionValue of cursorStyleOptions) {
    const option = document.createElement("option");
    option.value = optionValue.value;
    option.textContent = optionValue.label;
    select.append(option);
  }
  select.value = cursorStyleValues.has(value) ? value : cursorStyleOptions[0].value;
  select.addEventListener("change", () => {
    if (!draftSettings) {
      return;
    }

    draftSettings.appearance.cursorStyle = select.value as CursorStyle;
    updateSaveState();
  });

  return createAppearanceRow(labelText, hintText, select);
}

function createAppearanceNumberRow(
  labelText: string,
  key: keyof Pick<AppearanceSettings, "fontSize" | "letterSpacing" | "lineHeight">,
  value: number,
  min: number,
  max: number,
  step: number,
  hintText: string
): HTMLDivElement {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "settings-input";
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.addEventListener("input", () => {
    if (!draftSettings) {
      return;
    }

    const nextValue = Number(input.value);
    if (Number.isFinite(nextValue)) {
      draftSettings.appearance[key] = key === "fontSize" ? clamp(nextValue, min, max) : clampFloat(nextValue, min, max);
    }
    updateSaveState();
  });

  return createAppearanceRow(labelText, hintText, input);
}

function createAppearanceRow(labelText: string, hintText: string, control: HTMLElement): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "appearance-editor-row";

  const label = document.createElement("label");
  label.className = "appearance-editor-label";
  const labelId = `appearance-${labelText.toLowerCase().replaceAll(/\s+/g, "-")}`;
  control.id = labelId;
  label.htmlFor = labelId;
  label.textContent = labelText;

  const text = document.createElement("div");
  const hint = document.createElement("div");
  hint.className = "appearance-editor-hint";
  hint.textContent = hintText;
  text.append(label, hint);

  row.append(text, control);
  return row;
}

function createTerminalInputState(view: RendererTerminalTab): TerminalInputState {
  const suggestionOverlay = document.createElement("div");
  suggestionOverlay.className = "suggestion-overlay";

  const searchPanel = document.createElement("div");
  searchPanel.className = "terminal-search-panel";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "terminal-search-input";
  searchInput.placeholder = "Find in terminal";
  const previousButton = document.createElement("button");
  previousButton.type = "button";
  previousButton.className = "terminal-search-button";
  previousButton.textContent = "Prev";
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "terminal-search-button";
  nextButton.textContent = "Next";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "terminal-search-button";
  closeButton.textContent = "x";
  const searchStatus = document.createElement("div");
  searchStatus.className = "terminal-search-status";
  searchPanel.append(searchInput, searchStatus, previousButton, nextButton, closeButton);

  const historyPanel = document.createElement("div");
  historyPanel.className = "history-search-panel";
  const historyInput = document.createElement("input");
  historyInput.type = "text";
  historyInput.className = "history-search-input";
  historyInput.placeholder = "Search command history";
  const historyResults = document.createElement("div");
  historyResults.className = "history-search-results";
  historyPanel.append(historyInput, historyResults);
  view.element.append(suggestionOverlay, searchPanel, historyPanel);

  searchInput.addEventListener("input", () => {
    runTerminalSearch(view.metadata.id, "next", true);
  });
  previousButton.addEventListener("click", () => {
    runTerminalSearch(view.metadata.id, "previous", false);
    searchInput.focus();
  });
  nextButton.addEventListener("click", () => {
    runTerminalSearch(view.metadata.id, "next", false);
    searchInput.focus();
  });
  closeButton.addEventListener("click", () => {
    closeTerminalSearch(view.metadata.id);
  });

  historyInput.addEventListener("input", () => {
    if (!activeHistorySearch || activeHistorySearch.tabId !== view.metadata.id) {
      return;
    }

    activeHistorySearch.query = historyInput.value;
    activeHistorySearch.interactionMode = "keyboard";
    activeHistorySearch.selectedIndex = 0;
    activeHistorySearch.results = getHistorySearchResults(historyInput.value);
    renderHistorySearch();
  });

  return {
    line: "",
    cursor: 0,
    dismissedSuggestionFor: "",
    suggestion: null,
    suggestionOverlay,
    searchPanel,
    searchInput,
    searchStatus,
    searchQuery: "",
    searchResultCount: 0,
    searchResultIndex: -1,
    historyPanel,
    historyInput,
    historyResults
  };
}

function handleTerminalKeyEvent(tabId: string, event: KeyboardEvent): boolean {
  if (event.type !== "keydown" || isSettingsOpen()) {
    return true;
  }

  const state = inputStates.get(tabId);
  if (!state) {
    return true;
  }

  if (activeHistorySearch) {
    return activeHistorySearch.tabId !== tabId;
  }

  if (isTabInAlternateBuffer(tabId)) {
    return true;
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "r") {
    openHistorySearch(tabId);
    return false;
  }

  if (event.key === "Escape") {
    state.dismissedSuggestionFor = state.line;
    updateSuggestion(tabId);
    return true;
  }

  if (!state.suggestion) {
    return true;
  }

  const shouldAcceptAll =
    (event.key === "ArrowRight" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) ||
    (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "f") ||
    (appSettings?.features.autosuggestions.acceptWithTab === true && event.key === "Tab");
  if (shouldAcceptAll && isCursorAtTrackedLineEnd(tabId)) {
    acceptSuggestion(tabId, "all");
    return false;
  }

  if (event.key === "ArrowRight" && event.ctrlKey && !event.metaKey && !event.altKey && isCursorAtTrackedLineEnd(tabId)) {
    acceptSuggestion(tabId, "partial");
    return false;
  }

  return true;
}

function handleTerminalInputData(tabId: string, data: string): boolean {
  const state = inputStates.get(tabId);
  const view = tabs.get(tabId);
  if (!state || !view || activeHistorySearch?.tabId === tabId) {
    return false;
  }

  if (isTabInAlternateBuffer(tabId)) {
    state.line = "";
    state.cursor = 0;
    state.dismissedSuggestionFor = "";
    state.suggestion = null;
    hideSuggestion(state);
    return false;
  }

  if (data === "\x06" && state.suggestion) {
    acceptSuggestion(tabId, "all");
    return true;
  }

  if (data === "\x12") {
    openHistorySearch(tabId);
    return true;
  }

  if (data === "\r") {
    const command = state.line;
    state.line = "";
    state.cursor = 0;
    state.dismissedSuggestionFor = "";
    state.suggestion = null;
    hideSuggestion(state);
    recordCommandIfEligible(tabId, command).catch((error) => {
      console.warn("Failed to record command history", error);
    });
    return false;
  }

  if (data === "\x7f") {
    if (state.cursor > 0) {
      state.line = `${state.line.slice(0, state.cursor - 1)}${state.line.slice(state.cursor)}`;
      state.cursor -= 1;
    }
    state.dismissedSuggestionFor = "";
    state.suggestion = null;
    hideSuggestion(state);
    return false;
  }

  if (data === "\x15") {
    state.line = "";
    state.cursor = 0;
    state.dismissedSuggestionFor = "";
    state.suggestion = null;
    hideSuggestion(state);
    return false;
  }

  if (data === "\x03" || data === "\x04") {
    state.line = "";
    state.cursor = 0;
    state.dismissedSuggestionFor = "";
    state.suggestion = null;
    hideSuggestion(state);
    return false;
  }

  if (isPrintableInput(data)) {
    state.line = `${state.line.slice(0, state.cursor)}${data}${state.line.slice(state.cursor)}`;
    state.cursor += data.length;
    state.dismissedSuggestionFor = "";
    state.suggestion = null;
    hideSuggestion(state);
    return false;
  }

  if (data.startsWith("\x1b")) {
    updateTrackedCursor(state, data);
    state.dismissedSuggestionFor = state.line;
    state.suggestion = null;
    hideSuggestion(state);
  }

  return false;
}

async function recordCommandIfEligible(tabId: string, rawCommand: string): Promise<void> {
  if (!appSettings?.features.commandHistory.enabled) {
    return;
  }
  if (appSettings.features.commandHistory.shellIntegration) {
    return;
  }

  const command = rawCommand.trimEnd();
  if (command.trim().length === 0 || command.startsWith(" ") || isTabInAlternateBuffer(tabId)) {
    return;
  }

  const view = tabs.get(tabId);
  commandHistory = await window.terminalApi.recordCommandHistory({
    command,
    cwd: view?.metadata.cwd,
    maxEntries: appSettings.features.commandHistory.maxEntries
  });
}

function updateActiveSuggestion(): void {
  if (!activeTabId) {
    return;
  }
  updateSuggestion(activeTabId);
}

function scheduleSuggestionUpdate(tabId: string): void {
  window.requestAnimationFrame(() => {
    updateSuggestion(tabId);
  });
}

function updateSuggestion(tabId: string): void {
  const state = inputStates.get(tabId);
  if (!state || tabId !== activeTabId || !appSettings?.features.autosuggestions.enabled) {
    if (state) {
      state.suggestion = null;
      hideSuggestion(state);
    }
    return;
  }

  if (
    state.line.length === 0 ||
    state.cursor !== state.line.length ||
    state.dismissedSuggestionFor === state.line ||
    isTabInAlternateBuffer(tabId)
  ) {
    state.suggestion = null;
    hideSuggestion(state);
    return;
  }

  const suggestion = getBestSuggestion(tabId, state.line);
  state.suggestion = suggestion;
  if (!suggestion) {
    hideSuggestion(state);
    return;
  }

  renderSuggestion(tabId, suggestion.command.slice(state.line.length));
}

function getBestSuggestion(tabId: string, prefix: string): CommandHistoryEntry | null {
  const view = tabs.get(tabId);
  const sameCwd = view?.metadata.cwd;
  const matches = commandHistory
    .filter((entry) => entry.command.startsWith(prefix) && entry.command !== prefix)
    .sort((left, right) => {
      const leftSameCwd = left.cwd === sameCwd ? 1 : 0;
      const rightSameCwd = right.cwd === sameCwd ? 1 : 0;
      if (leftSameCwd !== rightSameCwd) {
        return rightSameCwd - leftSameCwd;
      }
      return right.lastRunAt.localeCompare(left.lastRunAt);
    });

  return matches[0] ?? null;
}

function renderSuggestion(tabId: string, suffix: string): void {
  const state = inputStates.get(tabId);
  const view = tabs.get(tabId);
  if (!state || !view || suffix.length === 0) {
    if (state) {
      hideSuggestion(state);
    }
    return;
  }

  const cell = estimateTerminalCellSize(view);
  const origin = getTerminalScreenOrigin(view);
  state.suggestionOverlay.textContent = suffix;
  state.suggestionOverlay.style.fontFamily = view.terminal.options.fontFamily ?? "";
  state.suggestionOverlay.style.fontSize = `${view.terminal.options.fontSize ?? 13}px`;
  state.suggestionOverlay.style.letterSpacing = `${view.terminal.options.letterSpacing ?? 0}px`;
  state.suggestionOverlay.style.lineHeight = `${cell.height}px`;
  state.suggestionOverlay.style.left = `${origin.left + view.terminal.buffer.active.cursorX * cell.width}px`;
  state.suggestionOverlay.style.top = `${origin.top + view.terminal.buffer.active.cursorY * cell.height}px`;
  state.suggestionOverlay.classList.add("is-visible");
}

function hideSuggestion(state: TerminalInputState): void {
  state.suggestionOverlay.classList.remove("is-visible");
}

function acceptSuggestion(tabId: string, mode: "all" | "partial"): void {
  const state = inputStates.get(tabId);
  if (!state?.suggestion) {
    return;
  }

  const suffix = state.suggestion.command.slice(state.line.length);
  const accepted = mode === "all" ? suffix : getPartialSuggestionSuffix(suffix);
  if (accepted.length === 0) {
    return;
  }

  state.line += accepted;
  state.cursor = state.line.length;
  state.dismissedSuggestionFor = "";
  window.terminalApi.writeTerminal({ id: tabId, data: accepted });
  state.suggestion = null;
  hideSuggestion(state);
}

function getPartialSuggestionSuffix(suffix: string): string {
  const firstBoundary = suffix.slice(1).search(/[\s/]/);
  if (firstBoundary === -1) {
    return suffix;
  }
  return suffix.slice(0, firstBoundary + 2);
}

function openHistorySearch(tabId: string): void {
  if (!appSettings?.features.commandHistory.enabled) {
    return;
  }

  const state = inputStates.get(tabId);
  if (!state) {
    return;
  }

  state.suggestion = null;
  hideSuggestion(state);
  activeHistorySearch = {
    tabId,
    query: state.line,
    interactionMode: "keyboard",
    selectedIndex: 0,
    results: getHistorySearchResults(state.line)
  };
  state.historyInput.value = state.line;
  renderHistorySearch();
  state.historyPanel.classList.add("is-open");
  state.historyInput.focus();
}

function closeHistorySearch(): void {
  if (!activeHistorySearch) {
    return;
  }

  const state = inputStates.get(activeHistorySearch.tabId);
  const tabId = activeHistorySearch.tabId;
  if (state) {
    state.historyPanel.classList.remove("is-open");
    state.historyResults.replaceChildren();
  }
  activeHistorySearch = null;
  tabs.get(tabId)?.terminal.focus();
  if (state) {
    state.suggestion = null;
    hideSuggestion(state);
  }
}

function openTerminalSearch(): void {
  if (!activeTabId) {
    return;
  }

  const state = inputStates.get(activeTabId);
  const view = tabs.get(activeTabId);
  if (!state || !view) {
    return;
  }

  closeHistorySearch();
  activeTerminalSearchTabId = activeTabId;
  state.suggestion = null;
  hideSuggestion(state);
  state.searchPanel.classList.add("is-open");
  state.searchInput.value = state.searchQuery;
  renderTerminalSearchStatus(state);
  if (state.searchQuery.length > 0) {
    runTerminalSearch(activeTabId, "next", true);
  }
  state.searchInput.focus();
  state.searchInput.select();
}

function closeTerminalSearch(tabId = activeTerminalSearchTabId): void {
  if (!tabId) {
    return;
  }

  const state = inputStates.get(tabId);
  const view = tabs.get(tabId);
  if (state) {
    state.searchPanel.classList.remove("is-open");
    state.searchResultCount = 0;
    state.searchResultIndex = -1;
    renderTerminalSearchStatus(state);
  }
  view?.searchAddon.clearDecorations();
  view?.terminal.clearSelection();
  if (activeTerminalSearchTabId === tabId) {
    activeTerminalSearchTabId = null;
  }
  view?.terminal.focus();
}

function handleTerminalSearchKeydown(event: KeyboardEvent): void {
  if (!activeTerminalSearchTabId) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeTerminalSearch(activeTerminalSearchTabId);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    runTerminalSearch(activeTerminalSearchTabId, event.shiftKey ? "previous" : "next", false);
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
    event.preventDefault();
    runTerminalSearch(activeTerminalSearchTabId, event.shiftKey ? "previous" : "next", false);
  }
}

function runTerminalSearch(tabId: string, direction: "next" | "previous", incremental: boolean): void {
  const state = inputStates.get(tabId);
  const view = tabs.get(tabId);
  if (!state || !view) {
    return;
  }

  const query = state.searchInput.value;
  state.searchQuery = query;
  if (query.length === 0) {
    view.searchAddon.clearDecorations();
    view.terminal.clearSelection();
    state.searchResultCount = 0;
    state.searchResultIndex = -1;
    renderTerminalSearchStatus(state);
    return;
  }

  const options = {
    incremental,
    decorations: {
      matchBackground: "#544a24",
      matchOverviewRuler: "#c9a227",
      activeMatchBackground: "#8a5a1f",
      activeMatchColorOverviewRuler: "#f59e0b"
    }
  };
  const found =
    direction === "previous" ? view.searchAddon.findPrevious(query, options) : view.searchAddon.findNext(query, options);
  if (!found) {
    state.searchResultCount = 0;
    state.searchResultIndex = -1;
    renderTerminalSearchStatus(state);
  }
}

function renderTerminalSearchStatus(state: TerminalInputState): void {
  if (state.searchQuery.length === 0) {
    state.searchStatus.textContent = "";
    return;
  }

  if (state.searchResultCount <= 0) {
    state.searchStatus.textContent = "No results";
    return;
  }

  state.searchStatus.textContent = `${state.searchResultIndex + 1}/${state.searchResultCount}`;
}

function handleHistorySearchKeydown(event: KeyboardEvent): void {
  if (!activeHistorySearch) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeHistorySearch();
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    selectHistorySearchResult(activeHistorySearch.selectedIndex + 1, "keyboard");
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    selectHistorySearchResult(activeHistorySearch.selectedIndex - 1, "keyboard");
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    const entry = activeHistorySearch.results[activeHistorySearch.selectedIndex];
    if (entry) {
      replaceCurrentLine(activeHistorySearch.tabId, entry.command, event.metaKey || event.ctrlKey);
    }
    closeHistorySearch();
  }
}

function getHistorySearchResults(query: string): CommandHistoryEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  const scored = commandHistory
    .map((entry) => ({ entry, score: scoreHistoryEntry(entry, normalizedQuery) }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return right.entry.lastRunAt.localeCompare(left.entry.lastRunAt);
    });

  return scored.slice(0, historySearchResultLimit).map((item) => item.entry);
}

function scoreHistoryEntry(entry: CommandHistoryEntry, query: string): number {
  if (query.length === 0) {
    return 0;
  }

  const command = entry.command.toLowerCase();
  const cwd = entry.cwd?.toLowerCase() ?? "";
  if (command.startsWith(query)) {
    return 0;
  }
  if (command.includes(query)) {
    return 1;
  }
  if (cwd.includes(query)) {
    return 2;
  }
  if (isFuzzyMatch(command, query)) {
    return 3;
  }
  return -1;
}

function renderHistorySearch(): void {
  if (!activeHistorySearch) {
    return;
  }

  const state = inputStates.get(activeHistorySearch.tabId);
  if (!state) {
    return;
  }

  state.historyResults.replaceChildren();
  for (const [index, entry] of activeHistorySearch.results.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-search-result";
    button.classList.toggle("is-selected", index === activeHistorySearch.selectedIndex);
    button.addEventListener("mouseenter", () => {
      if (!activeHistorySearch || activeHistorySearch.interactionMode !== "mouse") {
        return;
      }
      selectHistorySearchResult(index, "mouse");
    });
    button.addEventListener("mousemove", () => {
      selectHistorySearchResult(index, "mouse");
    });
    button.addEventListener("click", () => {
      replaceCurrentLine(activeHistorySearch?.tabId ?? "", entry.command, false);
      closeHistorySearch();
    });

    const content = document.createElement("div");
    const command = document.createElement("div");
    command.className = "history-search-command";
    command.textContent = entry.command;
    const meta = document.createElement("div");
    meta.className = "history-search-meta";
    meta.textContent = [entry.cwd, formatLastRun(entry.lastRunAt)].filter(Boolean).join(" | ");
    content.append(command, meta);

    const count = document.createElement("div");
    count.className = "history-search-count";
    count.textContent = `${entry.runCount}x`;
    button.append(content, count);
    state.historyResults.append(button);
  }
}

function selectHistorySearchResult(index: number, interactionMode: "keyboard" | "mouse"): void {
  if (!activeHistorySearch) {
    return;
  }

  const selectedIndex =
    activeHistorySearch.results.length === 0
      ? 0
      : Math.max(0, Math.min(activeHistorySearch.results.length - 1, index));

  if (
    activeHistorySearch.selectedIndex === selectedIndex &&
    activeHistorySearch.interactionMode === interactionMode
  ) {
    return;
  }

  activeHistorySearch.interactionMode = interactionMode;
  activeHistorySearch.selectedIndex = selectedIndex;
  renderHistorySearch();
}

function replaceCurrentLine(tabId: string, command: string, run: boolean): void {
  const state = inputStates.get(tabId);
  if (!state) {
    return;
  }

  const data = `${"\x7f".repeat(state.line.length)}${command}${run ? "\r" : ""}`;
  state.line = run ? "" : command;
  state.cursor = state.line.length;
  state.dismissedSuggestionFor = "";
  window.terminalApi.writeTerminal({ id: tabId, data });
  if (run) {
    recordCommandIfEligible(tabId, command).catch((error) => {
      console.warn("Failed to record command history", error);
    });
  }
}

function isPrintableInput(data: string): boolean {
  return !data.includes("\x1b") && !data.includes("\r") && !data.includes("\n") && /^[^\x00-\x1f\x7f]+$/.test(data);
}

function updateTrackedCursor(state: TerminalInputState, data: string): void {
  if (data === "\x1b[D") {
    state.cursor = Math.max(0, state.cursor - 1);
  } else if (data === "\x1b[C") {
    state.cursor = Math.min(state.line.length, state.cursor + 1);
  } else if (data === "\x1b[H" || data === "\x1b[1~") {
    state.cursor = 0;
  } else if (data === "\x1b[F" || data === "\x1b[4~") {
    state.cursor = state.line.length;
  }
}

function isCursorAtTrackedLineEnd(tabId: string): boolean {
  const state = inputStates.get(tabId);
  const view = tabs.get(tabId);
  if (!state || !view) {
    return false;
  }
  return state.cursor === state.line.length;
}

function isTabInAlternateBuffer(tabId: string): boolean {
  const view = tabs.get(tabId);
  return view?.terminal.buffer.active.type === "alternate";
}

function estimateTerminalCellSize(view: RendererTerminalTab): { width: number; height: number } {
  const dimensions = getXtermRenderDimensions(view);
  if (dimensions) {
    return dimensions;
  }

  const fontSize = view.terminal.options.fontSize ?? 13;
  const lineHeight = view.terminal.options.lineHeight ?? 1.2;
  const letterSpacing = view.terminal.options.letterSpacing ?? 0;
  return {
    width: fontSize * 0.62 + letterSpacing,
    height: fontSize * lineHeight
  };
}

function getTerminalScreenOrigin(view: RendererTerminalTab): { left: number; top: number } {
  const screen = view.element.querySelector<HTMLElement>(".xterm-screen");
  if (!screen) {
    return { left: 0, top: 0 };
  }

  const paneRect = view.element.getBoundingClientRect();
  const screenRect = screen.getBoundingClientRect();
  return {
    left: screenRect.left - paneRect.left,
    top: screenRect.top - paneRect.top
  };
}

function getXtermRenderDimensions(view: RendererTerminalTab): { width: number; height: number } | null {
  const terminalWithCore = view.terminal as unknown as {
    _core?: {
      _renderService?: {
        dimensions?: {
          css?: {
            cell?: {
              width?: number;
              height?: number;
            };
          };
        };
      };
    };
  };
  const cell = terminalWithCore._core?._renderService?.dimensions?.css?.cell;
  if (!cell?.width || !cell.height) {
    return null;
  }

  return {
    width: cell.width,
    height: cell.height
  };
}

function isFuzzyMatch(value: string, query: string): boolean {
  let cursor = 0;
  for (const char of query) {
    cursor = value.indexOf(char, cursor);
    if (cursor === -1) {
      return false;
    }
    cursor += 1;
  }
  return true;
}

function formatLastRun(lastRunAt: string): string {
  const timestamp = Number(lastRunAt);
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Date(timestamp).toLocaleString();
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
    showSettingsStatus(copy().errors.shortcutRequiresModifier, true);
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
  if (!draftSettings || isSavingSettings) {
    return;
  }

  const validation = validateSettings(draftSettings);
  if (!validation.valid) {
    showSettingsStatus(validation.messages.join(" "), true);
    updateSaveState();
    return;
  }

  isSavingSettings = true;
  updateSaveState();

  try {
    const snapshot = await window.terminalApi.saveAppSettings(cloneSettings(draftSettings));
    settingsSnapshot = snapshot;
    appSettings = cloneSettings(snapshot.settings);
    draftSettings = cloneSettings(snapshot.settings);
    renderQuickCommands();
    applyAppearanceToTerminalViews(appSettings.appearance);
    updateActiveSuggestion();
    if (!appSettings.features.sessionRestore.enabled) {
      closedSessionTabs = [];
      sessionSaveSignature = "";
      await window.terminalApi.clearTerminalSessions();
    } else {
      markSessionsDirty();
    }
    renderSettingsModal();
    showSettingsNotice(snapshot.notice ?? "");

    if (snapshot.globalShortcutErrors.length > 0) {
      showSettingsStatus(snapshot.globalShortcutErrors.map((error) => error.message).join(" "), true);
      return;
    }

    closeSettings();
  } finally {
    isSavingSettings = false;
    updateSaveState();
  }
}

async function checkForUpdates(): Promise<void> {
  checkUpdatesButton.disabled = true;
  showSettingsStatus(copy().status.checkingUpdates);

  try {
    const result = await window.terminalApi.installUpdateIfAvailable();
    if (!result.available) {
      showSettingsStatus(copy().status.upToDate);
      return;
    }

    showSettingsStatus(copy().installingUpdate(result.version));
  } finally {
    checkUpdatesButton.disabled = false;
  }
}

function validateSettings(settings: AppSettings): ValidationResult {
  const messages: string[] = [];
  const commandIds = new Set<string>();

  for (const command of settings.commands) {
    if (command.label.trim().length === 0) {
      messages.push(copy().errors.emptyCommandLabel);
    }

    if (command.command.trim().length === 0) {
      messages.push(copy().commandCannotBeEmpty(command.label));
    }

    if (commandIds.has(command.id)) {
      messages.push(copy().duplicateCommandId(command.id));
    }
    commandIds.add(command.id);
  }

  if (!languageValues.has(settings.language)) {
    messages.push(copy().errors.language);
  }

  if (!fontFamilyValues.has(settings.appearance.fontFamily)) {
    messages.push(copy().errors.fontFamily);
  }

  if (!isInRange(settings.appearance.fontSize, 10, 28)) {
    messages.push(copy().errors.fontSize);
  }

  if (!isInRange(settings.appearance.letterSpacing, -1, 4)) {
    messages.push(copy().errors.letterSpacing);
  }

  if (!isInRange(settings.appearance.lineHeight, 1, 1.8)) {
    messages.push(copy().errors.lineHeight);
  }

  if (!cursorStyleValues.has(settings.appearance.cursorStyle)) {
    messages.push(copy().errors.cursorStyle);
  }

  if (!Number.isInteger(settings.features.commandHistory.maxEntries)) {
    messages.push(copy().errors.maxHistoryInteger);
  } else if (!isInRange(settings.features.commandHistory.maxEntries, 100, 50000)) {
    messages.push(copy().errors.maxHistoryRange);
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
      messages.push(copy().assignedShortcut(displayAccelerator(binding.accelerator), actionLabels.get(existing) ?? existing));
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
  saveSettingsButton.disabled = isSavingSettings || !validation.valid;

  if (!validation.valid) {
    showSettingsStatus(validation.messages[0] ?? copy().status.settingsInvalid, true);
  } else if (settingsStatusElement.classList.contains("is-error")) {
    showSettingsStatus("", false);
  }
}

function getShortcutActions(settings: AppSettings): ShortcutAction[] {
  return [
    ...fixedShortcutActions.map((action) => {
      const selectTabMatch = action.id.match(/^selectTab:(\d)$/);
      return {
        id: action.id,
        label: selectTabMatch ? copy().selectTab(Number(selectTabMatch[1])) : copy().shortcutActions[action.labelKey],
        defaultScope: action.defaultScope
      };
    }),
    ...settings.commands.map((command) => ({
      id: `runCommand:${command.id}`,
      label: copy().runCommandAction(command.label),
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
    Backquote: "`",
    Backslash: "\\",
    Escape: "Esc",
    Delete: "Delete",
    Backspace: "Backspace",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown"
  };
  const codeKey = codeMap[event.code];
  if (codeKey) {
    return codeKey;
  }

  if (/^Key[A-Z]$/.test(event.code)) {
    return event.code.slice("Key".length);
  }

  if (/^Digit[0-9]$/.test(event.code)) {
    return event.code.slice("Digit".length);
  }

  if (/^Numpad[0-9]$/.test(event.code)) {
    return event.code.slice("Numpad".length);
  }

  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) {
    return event.code;
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
    "`": "`",
    "\\": "\\",
    Escape: "Esc",
    Delete: "Delete",
    Backspace: "Backspace",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown"
  };

  return keyMap[key] ?? null;
}

function displayAccelerator(accelerator: string): string {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return accelerator.replace("CmdOrCtrl", isMac ? "Cmd" : "Ctrl");
}

function showSettingsStatus(message: string, isError = false): void {
  settingsStatusElement.textContent = message;
  settingsStatusElement.classList.toggle("is-error", isError);
}

function showSettingsNotice(message: string): void {
  settingsNoticeElement.textContent = message;
  settingsNoticeElement.classList.toggle("is-visible", message.length > 0);
}

function confirmCommandAction(message: string, confirmLabel: string): Promise<boolean> {
  resolveCommandConfirmation(false);

  const backdrop = document.createElement("div");
  backdrop.className = "command-confirm-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "settings-confirm";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");

  const text = document.createElement("p");
  text.textContent = message;

  const actions = document.createElement("div");
  actions.className = "settings-confirm-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "settings-secondary-button";
  cancelButton.textContent = "Cancel";

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "settings-primary-button";
  confirmButton.textContent = confirmLabel;

  actions.append(cancelButton, confirmButton);
  dialog.append(text, actions);
  backdrop.append(dialog);
  document.body.append(backdrop);

  return new Promise((resolve) => {
    activeCommandConfirmation = {
      resolve,
      element: backdrop
    };

    cancelButton.addEventListener("click", () => {
      resolveCommandConfirmation(false);
    });
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        resolveCommandConfirmation(false);
      }
    });
    confirmButton.addEventListener("click", () => {
      resolveCommandConfirmation(true);
    });
    confirmButton.focus();
  });
}

function resolveCommandConfirmation(confirmed: boolean): void {
  if (!activeCommandConfirmation) {
    return;
  }

  const confirmation = activeCommandConfirmation;
  activeCommandConfirmation = null;
  confirmation.element.remove();
  confirmation.resolve(confirmed);
}

function confirmSettingsAction(message: string, confirmLabel: string): Promise<boolean> {
  resolveSettingsConfirmation(false);

  const backdrop = document.createElement("div");
  backdrop.className = "settings-confirm-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "settings-confirm";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");

  const text = document.createElement("p");
  text.textContent = message;

  const actions = document.createElement("div");
  actions.className = "settings-confirm-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "settings-secondary-button";
  cancelButton.textContent = copy().buttons.cancel;

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className =
    confirmLabel === settingsCopy.en.buttons.delete || confirmLabel === settingsCopy.ja.buttons.delete
      ? "settings-danger-button"
      : "settings-primary-button";
  confirmButton.textContent = confirmLabel;

  actions.append(cancelButton, confirmButton);
  dialog.append(text, actions);
  backdrop.append(dialog);
  settingsDialog.append(backdrop);

  return new Promise((resolve) => {
    activeSettingsConfirmation = {
      resolve,
      element: backdrop
    };

    cancelButton.addEventListener("click", () => {
      resolveSettingsConfirmation(false);
    });
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        resolveSettingsConfirmation(false);
      }
    });
    confirmButton.addEventListener("click", () => {
      resolveSettingsConfirmation(true);
    });
    confirmButton.focus();
  });
}

function resolveSettingsConfirmation(confirmed: boolean): void {
  if (!activeSettingsConfirmation) {
    return;
  }

  const confirmation = activeSettingsConfirmation;
  activeSettingsConfirmation = null;
  confirmation.element.remove();
  confirmation.resolve(confirmed);
}

function hasUnsavedChanges(): boolean {
  return Boolean(draftSettings && appSettings && JSON.stringify(draftSettings) !== JSON.stringify(appSettings));
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    language: settings.language,
    commands: settings.commands.map((command) => ({ ...command })),
    shortcuts: Object.fromEntries(
      Object.entries(settings.shortcuts).map(([actionId, binding]) => [actionId, { ...binding }])
    ),
    layout: {
      commandPanelWidth: settings.layout.commandPanelWidth
    },
    appearance: {
      ...settings.appearance
    },
    features: cloneFeatures(settings.features)
  };
}

function cloneFeatures(features: FeatureSettings): FeatureSettings {
  return {
    commandHistory: { ...features.commandHistory },
    autosuggestions: { ...features.autosuggestions },
    sessionRestore: { ...features.sessionRestore }
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function getActiveAppearance(): AppearanceSettings {
  return (
    appSettings?.appearance ?? {
      fontFamily: "Menlo, Monaco, Consolas, 'Courier New', monospace",
      fontSize: 13,
      letterSpacing: 0,
      lineHeight: 1.2,
      cursorStyle: "block"
    }
  );
}

function applyAppearanceToTerminalViews(appearance: AppearanceSettings): void {
  for (const view of tabs.values()) {
    view.terminal.options.fontFamily = appearance.fontFamily;
    view.terminal.options.fontSize = appearance.fontSize;
    view.terminal.options.letterSpacing = appearance.letterSpacing;
    view.terminal.options.lineHeight = appearance.lineHeight;
    view.terminal.options.cursorStyle = appearance.cursorStyle;
  }

  scheduleFitActiveTerminal();
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
