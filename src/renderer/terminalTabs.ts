import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { AppearanceSettings, TerminalTab } from "../shared/terminalTypes";

export type RendererTerminalTab = {
  metadata: TerminalTab;
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLDivElement;
};

export function createTerminalView(tab: TerminalTab, appearance: AppearanceSettings): RendererTerminalTab {
  const terminal = new Terminal({
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
