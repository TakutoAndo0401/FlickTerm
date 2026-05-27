import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { loadQuickCommands } from "./quickCommands";
import { createTerminalView, type RendererTerminalTab } from "./terminalTabs";
import type { QuickCommand, TerminalTab } from "../shared/terminalTypes";

const tabsElement = getElement("tabs");
const newTabButton = getElement("new-tab-button") as HTMLButtonElement;
const quickCommandsElement = getElement("quick-commands");
const terminalHost = getElement("terminal-host");

const tabs = new Map<string, RendererTerminalTab>();
let activeTabId: string | null = null;
let tabCounter = 0;
let resizeTimer: number | undefined;

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

newTabButton.addEventListener("click", () => {
  createTab().catch((error) => {
    console.error("Failed to create tab", error);
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
  await renderQuickCommands();
  await createTab();
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
    closeButton.addEventListener("click", (event) => {
      closeTab(id);
    });

    selectButton.append(label);
    tabItem.append(selectButton, closeButton);
    tabsElement.append(tabItem);
  }
}

async function renderQuickCommands(): Promise<void> {
  const commands = await loadQuickCommands();
  quickCommandsElement.replaceChildren();

  for (const command of commands) {
    quickCommandsElement.append(createQuickCommandButton(command));
  }
}

function createQuickCommandButton(command: QuickCommand): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quick-command-button";
  button.textContent = command.label;
  button.title = command.command;
  button.addEventListener("click", () => {
    if (!activeTabId) {
      return;
    }

    window.terminalApi.writeTerminal({
      id: activeTabId,
      data: `${command.command}\r`
    });
  });

  return button;
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
