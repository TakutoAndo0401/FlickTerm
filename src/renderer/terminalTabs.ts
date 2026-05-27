import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { TerminalTab } from "../shared/terminalTypes";

export type RendererTerminalTab = {
  metadata: TerminalTab;
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLDivElement;
};

export function createTerminalView(tab: TerminalTab): RendererTerminalTab {
  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: "Menlo, Monaco, Consolas, 'Courier New', monospace",
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 4000,
    theme: {
      background: "#111315",
      foreground: "#d6d8dc",
      cursor: "#ffffff",
      selectionBackground: "#355c7d"
    }
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const element = document.createElement("div");
  element.className = "terminal-pane";
  element.dataset.tabId = tab.id;

  return {
    metadata: tab,
    terminal,
    fitAddon,
    element
  };
}
