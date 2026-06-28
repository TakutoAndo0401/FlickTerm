import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal } from "@xterm/xterm";
import type { IDecoration, ITheme } from "@xterm/xterm";
import type { AppearanceSettings, TerminalTab } from "../shared/terminalTypes";

export type RendererTerminalTab = {
  metadata: TerminalTab;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  serializeAddon: SerializeAddon;
  element: HTMLDivElement;
  commandDecorations: IDecoration[];
};

const terminalTheme: ITheme = {
  background: "#0f1316",
  foreground: "#d7dde5",
  cursor: "#f8fafc",
  cursorAccent: "#0f1316",
  selectionBackground: "#254766",
  selectionForeground: "#f8fafc",
  selectionInactiveBackground: "#1f3448",
  scrollbarSliderBackground: "rgba(148, 163, 184, 0.20)",
  scrollbarSliderHoverBackground: "rgba(148, 163, 184, 0.34)",
  scrollbarSliderActiveBackground: "rgba(148, 163, 184, 0.46)",
  overviewRulerBorder: "#242c35",
  black: "#111827",
  red: "#f87171",
  green: "#34d399",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#d1d5db",
  brightBlack: "#6b7280",
  brightRed: "#fb7185",
  brightGreen: "#4ade80",
  brightYellow: "#facc15",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#f8fafc"
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
    overviewRuler: {
      width: 3
    },
    theme: terminalTheme
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
    element,
    commandDecorations: []
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
