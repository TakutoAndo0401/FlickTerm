import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal } from "@xterm/xterm";
import type { AppearanceSettings, TerminalTab } from "../shared/terminalTypes";

export type RendererTerminalTab = {
  metadata: TerminalTab;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  serializeAddon: SerializeAddon;
  element: HTMLDivElement;
};

export function createTerminalView(tab: TerminalTab, appearance: AppearanceSettings): RendererTerminalTab {
  const terminal = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: appearance.cursorStyle,
    fontFamily: appearance.fontFamily,
    fontSize: appearance.fontSize,
    letterSpacing: appearance.letterSpacing,
    lineHeight: appearance.lineHeight,
    scrollback: 4000,
    theme: {
      background: "#111315",
      foreground: "#d6d8dc",
      cursor: "#ffffff",
      selectionBackground: "#355c7d"
    }
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const serializeAddon = new SerializeAddon();
  const unicode11Addon = new Unicode11Addon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(serializeAddon);
  terminal.loadAddon(unicode11Addon);
  terminal.loadAddon(new WebLinksAddon(handleWebLink));
  terminal.unicode.activeVersion = "11";

  const element = document.createElement("div");
  element.className = "terminal-pane";
  element.dataset.tabId = tab.id;

  return {
    metadata: tab,
    terminal,
    fitAddon,
    searchAddon,
    serializeAddon,
    element
  };
}

function handleWebLink(event: MouseEvent, uri: string): void {
  if (!event.metaKey) {
    return;
  }

  const url = normalizeHttpUrl(uri);
  if (!url) {
    return;
  }

  event.preventDefault();
  void openUrl(url).catch((error) => {
    console.warn("Failed to open terminal link", { url, error });
  });
}

function normalizeHttpUrl(uri: string): string | null {
  const trimmed = trimTrailingUrlPunctuation(uri.trim());
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function trimTrailingUrlPunctuation(uri: string): string {
  let next = uri;
  while (/[.,;:!?]+$/.test(next)) {
    next = next.slice(0, -1);
  }

  while (next.endsWith(")") && countChar(next, "(") < countChar(next, ")")) {
    next = next.slice(0, -1);
  }
  while (next.endsWith("]") && countChar(next, "[") < countChar(next, "]")) {
    next = next.slice(0, -1);
  }
  while (next.endsWith("}") && countChar(next, "{") < countChar(next, "}")) {
    next = next.slice(0, -1);
  }

  return next;
}

function countChar(value: string, char: string): number {
  let count = 0;
  for (const current of value) {
    if (current === char) {
      count += 1;
    }
  }
  return count;
}
