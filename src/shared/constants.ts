import type { Settings } from "./model";

export const PROTOCOL_VERSION = 1;

export const VIEW_CONTAINER_ID = "activityreel";
export const VIEW_ID = "activityreel.feed";
export const PANEL_VIEW_TYPE = "activityreel.panel";
export const ABOUT_VIEW_TYPE = "activityreel.about";

export const STORAGE_FILE = "activityreel-activity.v1.json";
export const STORAGE_SCHEMA_VERSION = 1;
export const FILTERS_STATE_KEY = "activityreel.filters.v1";

export const COMMANDS = {
  open: "activityreel.open",
  togglePause: "activityreel.togglePause",
  clear: "activityreel.clear",
  exportJson: "activityreel.exportJson",
  exportMarkdown: "activityreel.exportMarkdown",
  about: "activityreel.about",
  testSnapshot: "activityreel.__test.snapshot",
} as const;

export const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/out/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/coverage/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/target/**",
  "**/.idea/**",
  "**/.cache/**",
] as const;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  maxEvents: 1000,
  maxDiffLines: 500,
  contextLines: 3,
  debounceMs: 300,
  persistHistory: true,
  trackFileOperations: true,
  trackExternalChanges: true,
  trackTasks: true,
  trackDebug: true,
  trackTerminal: true,
  excludeGlobs: [...DEFAULT_EXCLUDES],
  maxFileSizeKB: 2048,
  statusBar: true,
  locale: "auto",
  openFilesOutsideWorkspace: false,
};

export const LIMITS = {
  maxEventsMin: 100,
  maxEventsMax: 5000,
  maxDiffLinesMin: 50,
  maxDiffLinesMax: 5000,
  contextLinesMax: 10,
  debounceMinMs: 100,
  debounceMaxMs: 2000,
  debounceMaxFlushMs: 1500,
  saveStormMs: 250,
  fileDedupeMs: 1000,
  renamePairMs: 300,
  watcherDebounceMs: 500,
  debugRestartMs: 500,
  dispatchBatchMs: 100,
  retainedDiffEvents: 300,
  persistDebounceMs: 2000,
  persistMaxBytes: 8 * 1024 * 1024,
  dpLineSumLimit: 1700,
  dpCellLimit: 180_000,
  myersMaxEditDistance: 600,
  myersMaxMiddleLines: 20_000,
  diffTimeBudgetMs: 250,
  wordDiffMaxLineChars: 3000,
  wordDiffMaxPairs: 200,
  wordDiffMaxTokens: 400,
  minifiedAvgLineChars: 500,
  unifiedMaxBytes: 2 * 1024 * 1024,
  searchTextMaxChars: 400,
  maxSnapshotBytes: 64 * 1024 * 1024,
  feedPageSize: 200,
  mountedCardBudget: 40,
  maxClipboardBytes: 2 * 1024 * 1024,
} as const;

export const SECRET_WARNING =
  "Terminal commands are stored locally in this workspace history and may contain secrets.";
