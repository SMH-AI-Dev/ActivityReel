import * as vscode from "vscode";
import { COMMANDS } from "../shared/constants";

export interface CommandActions {
  open(): void;
  togglePause(): void;
  clear(): void;
  export(format: "json" | "markdown"): void;
  about(): void;
}

/** Public commands contributed in `package.json`; handlers stay thin and delegate to actions. */
export function registerCommands(actions: CommandActions): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMANDS.open, () => actions.open()),
    vscode.commands.registerCommand(COMMANDS.togglePause, () => actions.togglePause()),
    vscode.commands.registerCommand(COMMANDS.clear, () => actions.clear()),
    vscode.commands.registerCommand(COMMANDS.exportJson, () => actions.export("json")),
    vscode.commands.registerCommand(COMMANDS.exportMarkdown, () => actions.export("markdown")),
    vscode.commands.registerCommand(COMMANDS.about, () => actions.about()),
  ];
}
