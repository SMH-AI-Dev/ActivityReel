import * as vscode from "vscode";
import { readSettings } from "./core/config";
import type { ExportBundle } from "./core/export/exporters";
import { exportJson, exportMarkdown } from "./core/export/exporters";
import { createLogger } from "./core/logger";
import { basename, untitledLabel } from "./core/pathUtils";
import { isInsideWorkspace } from "./core/pathUtilsVscode";
import { ActivityStore } from "./core/store/activityStore";
import { HistoryPersistence } from "./core/store/historyPersistence";
import { VscodeStorageAdapter } from "./core/store/vscodePersistence";
import { TrackingController } from "./core/tracking/trackingController";
import {
  ABOUT_VIEW_TYPE,
  COMMANDS,
  FILTERS_STATE_KEY,
  LIMITS,
  PANEL_VIEW_TYPE,
  VIEW_ID,
} from "./shared/constants";
import { DEFAULT_FILTERS } from "./shared/model";
import type {
  DiffPayload,
  EventKind,
  Filters,
  SessionStats,
  TimeRange,
} from "./shared/model";
import { registerCommands } from "./ui/commands";
import { hostString, resolveLocale } from "./ui/i18n";
import { StatusBar } from "./ui/statusBar";
import type { WebviewFacade } from "./ui/webviewHost";
import { FeedSink, WebviewHub } from "./ui/webviewHost";

interface ActiveExtension {
  dispose(): Promise<void>;
}

let active: ActiveExtension | undefined;

const EVENT_KINDS: ReadonlySet<string> = new Set<EventKind>([
  "edit",
  "save",
  "file-create",
  "file-delete",
  "file-rename",
  "file-change",
  "task",
  "debug",
  "terminal",
]);
const TIME_RANGES: ReadonlySet<string> = new Set<TimeRange>(["session", "5m", "1h"]);

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadFilters(context: vscode.ExtensionContext): Filters {
  const raw = context.workspaceState.get<unknown>(FILTERS_STATE_KEY);
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_FILTERS, kinds: [] };
  const record = raw as Record<string, unknown>;
  const kinds: EventKind[] = [];
  if (Array.isArray(record.kinds)) {
    for (const kind of record.kinds) {
      if (typeof kind === "string" && EVENT_KINDS.has(kind) && !kinds.includes(kind as EventKind)) {
        kinds.push(kind as EventKind);
      }
    }
  }
  const query = typeof record.query === "string" ? record.query.slice(0, 200) : "";
  const timeRange =
    typeof record.timeRange === "string" && TIME_RANGES.has(record.timeRange)
      ? (record.timeRange as TimeRange)
      : "session";
  return { kinds, query, timeRange };
}

class FeedViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly hub: WebviewHub) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.hub.attach(view.webview, "sidebar");
    view.onDidDispose(() => this.hub.detach(view.webview));
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  if (active) return;

  const logger = createLogger();
  const version =
    typeof context.extension.packageJSON.version === "string" ? context.extension.packageJSON.version : "0.0.0";
  let settings = readSettings();
  let locale = resolveLocale(settings.locale, vscode.env.language);
  let paused = false;
  let filters = loadFilters(context);

  const store = new ActivityStore({ maxEvents: settings.maxEvents });

  let persistence: HistoryPersistence | undefined;
  function createPersistence(): HistoryPersistence | undefined {
    const folder = context.storageUri;
    if (!folder) return undefined;
    return new HistoryPersistence(store, new VscodeStorageAdapter(folder), {
      debounceMs: LIMITS.persistDebounceMs,
      onError: (error) => logger.warn(`History persistence failed: ${describeError(error)}`),
    });
  }

  if (settings.persistHistory) {
    persistence = createPersistence();
    if (persistence) {
      const result = await persistence.load();
      logger.info(`History load: ${result}`);
      if (result === "loaded") {
        for (const event of store.list()) {
          if (event.status === "running") store.update(event.id, { status: "done" });
        }
      }
    } else {
      logger.warn("Workspace storage is unavailable; history persistence is disabled.");
    }
  }

  const statusBar = new StatusBar();
  let panel: vscode.WebviewPanel | undefined;
  let aboutPanel: vscode.WebviewPanel | undefined;

  function mutated(): void {
    persistence?.schedule();
    statusBar.render(settings.statusBar, paused, store.stats(), locale);
  }

  const facade: WebviewFacade = {
    version,
    locale: () => locale,
    settings: () => settings,
    paused: () => paused,
    filters: () => filters,
    sessionId: () => store.sessionId,
    stats: (): SessionStats => store.stats(),
    pageNewest: () => store.pageNewest(LIMITS.feedPageSize),
    pageOlder: (beforeSeq) => store.pageOlder(beforeSeq, LIMITS.feedPageSize),
    getEvent: (id) => store.get(id),
    getDiff: (id) => store.getDiff(id),
    openEvent: (id) => void openEvent(id),
    setFilters,
    setPaused: applyPaused,
    requestClear: () => void requestClear(),
    requestExport: (format) => void requestExport(format),
    copyText: (text) => void copyText(text),
    openAbout,
    openPanel,
  };
  const hub = new WebviewHub(facade, context.extensionUri);

  const sink = new FeedSink(store, hub, () => paused, mutated);
  const trackers = new TrackingController({
    sink,
    logger,
    getSettings: () => settings,
  });
  trackers.start();

  function applyPaused(value: boolean): void {
    if (paused === value) return;
    if (value) {
      trackers.setPaused(true);
      paused = true;
    } else {
      paused = false;
      trackers.setPaused(false);
    }
    hub.broadcastState(paused, settings);
    hub.broadcastToast("info", hostString(locale, paused ? "paused" : "resumed"));
    statusBar.render(settings.statusBar, paused, store.stats(), locale);
  }

  function setFilters(next: Filters): void {
    filters = next;
    void context.workspaceState.update(FILTERS_STATE_KEY, next);
    hub.broadcastFilters(next);
  }

  async function copyText(text: string): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(text);
      hub.broadcastToast("info", hostString(locale, "copied"));
    } catch {
      hub.broadcastToast("error", hostString(locale, "exportFailed", "clipboard"));
    }
  }

  async function openEvent(id: string): Promise<void> {
    const event = store.get(id);
    if (!event || !("relPath" in event)) return;
    const relPath = event.relPath;

    const untitled = vscode.workspace.textDocuments.find(
      (document) => document.uri.scheme === "untitled" && untitledLabel(document.uri) === relPath,
    );
    if (untitled) {
      await vscode.window.showTextDocument(untitled);
      return;
    }

    const segments = relPath.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
      void vscode.window.showWarningMessage(hostString(locale, "openFailed"));
      return;
    }

    const folders = vscode.workspace.workspaceFolders ?? [];
    const candidates: vscode.Uri[] = [];
    if (folders.length > 1 && segments.length > 1) {
      const named = folders.find((folder) => basename(folder.uri) === segments[0]);
      if (named) candidates.push(vscode.Uri.joinPath(named.uri, ...segments.slice(1)));
    }
    for (const folder of folders) candidates.push(vscode.Uri.joinPath(folder.uri, ...segments));

    for (const candidate of candidates) {
      // Stored paths are workspace-relative, but never trust one to stay inside the workspace.
      if (!isInsideWorkspace(candidate, folders)) continue;
      try {
        const document = await vscode.workspace.openTextDocument(candidate);
        await vscode.window.showTextDocument(document);
        return;
      } catch {
        // Try the next candidate folder.
      }
    }
    void vscode.window.showWarningMessage(hostString(locale, "openFailed"));
  }

  async function requestClear(): Promise<void> {
    const clearLabel = hostString(locale, "clear");
    const answer = await vscode.window.showWarningMessage(
      hostString(locale, "clearQuestion"),
      { modal: true },
      clearLabel,
    );
    if (answer !== clearLabel) return;

    if (persistence) await persistence.clear(false);
    else store.clear();
    hub.notifyCleared();
    hub.broadcastStats(store.stats());
    statusBar.render(settings.statusBar, paused, store.stats(), locale);
    void vscode.window.showInformationMessage(hostString(locale, "cleared"));
  }

  async function requestExport(format: "json" | "markdown"): Promise<void> {
    const events = store.list();
    if (events.length === 0) {
      void vscode.window.showInformationMessage(hostString(locale, "nothingToExport"));
      return;
    }
    const diffs: Record<string, DiffPayload> = {};
    for (const event of events) {
      const payload = store.getDiff(event.id);
      if (payload) diffs[event.id] = payload;
    }
    const bundle: ExportBundle = {
      events,
      stats: store.stats(),
      diffs,
      meta: { exportedAt: Date.now(), extensionVersion: version, settings, sessionId: store.sessionId },
    };
    const text = format === "json" ? exportJson(bundle) : exportMarkdown(bundle);
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `codetrail-export-${date}.${format === "json" ? "json" : "md"}`;
    const folder = vscode.workspace.workspaceFolders?.[0];
    const target = await vscode.window.showSaveDialog({
      saveLabel: hostString(locale, format === "json" ? "exportJson" : "exportMarkdown"),
      defaultUri: folder ? vscode.Uri.joinPath(folder.uri, fileName) : undefined,
      filters: format === "json" ? { JSON: ["json"] } : { Markdown: ["md"] },
    });
    if (!target) return;
    try {
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
      void vscode.window.showInformationMessage(hostString(locale, "exported", target.fsPath));
    } catch (error) {
      void vscode.window.showErrorMessage(hostString(locale, "exportFailed", describeError(error)));
    }
  }

  function openPanel(): void {
    if (panel) {
      panel.reveal();
      return;
    }
    panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      hostString(locale, "panelTitle"),
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const created = panel;
    hub.attach(created.webview, "panel");
    created.onDidDispose(() => {
      hub.detach(created.webview);
      if (panel === created) panel = undefined;
    });
  }

  function openAbout(): void {
    if (aboutPanel) {
      aboutPanel.reveal();
      return;
    }
    aboutPanel = vscode.window.createWebviewPanel(
      ABOUT_VIEW_TYPE,
      hostString(locale, "aboutTitle"),
      vscode.ViewColumn.Active,
      { enableScripts: true },
    );
    const created = aboutPanel;
    hub.attach(created.webview, "about");
    created.onDidDispose(() => {
      hub.detach(created.webview);
      if (aboutPanel === created) aboutPanel = undefined;
    });
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, new FeedViewProvider(hub), {
      webviewOptions: { retainContextWhenHidden: false },
    }),
    vscode.window.registerWebviewPanelSerializer(PANEL_VIEW_TYPE, {
      deserializeWebviewPanel: async (restored: vscode.WebviewPanel) => {
        panel?.dispose();
        panel = restored;
        hub.attach(restored.webview, "panel");
        restored.onDidDispose(() => {
          hub.detach(restored.webview);
          if (panel === restored) panel = undefined;
        });
      },
    }),
    ...registerCommands({
      open: openPanel,
      togglePause: () => applyPaused(!paused),
      clear: () => void requestClear(),
      export: (format) => void requestExport(format),
      about: openAbout,
    }),
  );

  function ensurePersistence(): void {
    if (!settings.persistHistory) {
      const previous = persistence;
      persistence = undefined;
      if (previous) void previous.dispose();
      return;
    }
    if (persistence) return;
    persistence = createPersistence();
    if (!persistence) logger.warn("Workspace storage is unavailable; history persistence is disabled.");
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("codetrail")) return;
      settings = readSettings();
      store.setMaxEvents(settings.maxEvents);
      ensurePersistence();

      const nextLocale = resolveLocale(settings.locale, vscode.env.language);
      if (nextLocale !== locale) {
        locale = nextLocale;
        if (panel) panel.title = hostString(locale, "panelTitle");
        if (aboutPanel) aboutPanel.title = hostString(locale, "aboutTitle");
        hub.sendInitAll();
      }
      hub.broadcastState(paused, settings);
      statusBar.render(settings.statusBar, paused, store.stats(), locale);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (!settings.persistHistory) return;
      const previous = persistence;
      persistence = undefined;
      if (previous) void previous.dispose();
      persistence = createPersistence();
    }),
  );

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMANDS.testSnapshot, () => ({
        paused,
        trackedDocuments: trackers.snapshotForTest().trackedDocuments,
        sessionId: store.sessionId,
        stats: store.stats(),
        events: store.list(),
      })),
    );
  }

  statusBar.render(settings.statusBar, paused, store.stats(), locale);

  active = {
    dispose: async () => {
      try {
        await trackers.flushAll();
      } catch (error) {
        logger.warn(`Final flush failed: ${describeError(error)}`);
      }
      trackers.dispose();
      const pendingPersistence = persistence;
      persistence = undefined;
      if (pendingPersistence) await pendingPersistence.dispose();
      hub.dispose();
      statusBar.dispose();
      logger.dispose();
    },
  };
}

export async function deactivate(): Promise<void> {
  const instance = active;
  active = undefined;
  if (instance) await instance.dispose();
}
