import * as vscode from "vscode";
import { COMMANDS } from "../shared/constants";
import type { ResolvedLocale, SessionStats } from "../shared/model";
import { hostString } from "./i18n";

/** Status-bar entry: live counters and a pause indicator, click opens the panel. */
export class StatusBar {
  private item: vscode.StatusBarItem | undefined;

  render(
    enabled: boolean,
    paused: boolean,
    stats: SessionStats,
    locale: ResolvedLocale,
  ): void {
    if (!enabled) {
      this.item?.hide();
      return;
    }
    if (!this.item) {
      this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
      this.item.command = COMMANDS.open;
    }
    this.item.text = paused ? "$(debug-pause) ActivityReel" : "$(pulse) ActivityReel";
    const tooltip = new vscode.MarkdownString();
    tooltip.appendText(
      `ActivityReel\n${stats.events} ${hostString(locale, "events")} · ${stats.files} ${hostString(locale, "files")}\n`,
    );
    tooltip.appendText(
      `+${stats.added} ${hostString(locale, "added")} −${stats.removed} ${hostString(locale, "removed")}`,
    );
    if (paused) tooltip.appendText(`\n${hostString(locale, "pausedShort")}`);
    this.item.tooltip = tooltip;
    this.item.show();
  }

  dispose(): void {
    this.item?.dispose();
    this.item = undefined;
  }
}
