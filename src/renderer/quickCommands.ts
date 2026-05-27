import type { QuickCommand } from "../shared/terminalTypes";

export async function loadQuickCommands(): Promise<QuickCommand[]> {
  return window.terminalApi.getQuickCommands();
}
