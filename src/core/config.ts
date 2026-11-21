import type * as VscodeApi from "vscode";
import { DEFAULT_SETTINGS, LIMITS } from "../shared/constants";
import type { LocaleSetting, Settings } from "../shared/model";

declare const require: ((id: string) => unknown) | undefined;

export const CONFIG_SECTION = "codetrail";

const LOCALES: readonly LocaleSetting[] = ["auto", "en", "fa"];

interface NumericRule {
  min: number;
  max: number;
}

const NUMERIC_RULES = {
  maxEvents: { min: LIMITS.maxEventsMin, max: LIMITS.maxEventsMax },
  maxDiffLines: { min: LIMITS.maxDiffLinesMin, max: LIMITS.maxDiffLinesMax },
  contextLines: { min: 0, max: LIMITS.contextLinesMax },
  debounceMs: { min: LIMITS.debounceMinMs, max: LIMITS.debounceMaxMs },
  maxFileSizeKB: { min: 64, max: 65_536 },
} as const satisfies Record<string, NumericRule>;

type NumericKey = keyof typeof NUMERIC_RULES;

const BOOLEAN_KEYS = [
  "enabled",
  "persistHistory",
  "trackFileOperations",
  "trackExternalChanges",
  "trackTasks",
  "trackDebug",
  "trackTerminal",
  "statusBar",
  "openFilesOutsideWorkspace",
] as const;

type BooleanKey = (typeof BOOLEAN_KEYS)[number];

const DEFAULTS_BY_KEY = DEFAULT_SETTINGS as unknown as Record<string, unknown>;

/**
 * The `vscode` module is resolved lazily so `normalizeSettings` is unit-testable in plain Node
 * without a vscode mock. Inside the extension host the module is always present.
 */
type VscodeModule = typeof VscodeApi;

function loadVscode(): VscodeModule {
  // The Function constructor cannot see the module-scoped CJS `require`, so call it lexically.
  if (typeof require !== "function") throw new Error("vscode module unavailable");
  return require("vscode") as VscodeModule;
}

function clampNumber(raw: unknown, fallback: number, rule: NumericRule): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const rounded = Math.round(raw);
  return Math.min(rule.max, Math.max(rule.min, rounded));
}

function readBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function readGlobs(raw: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function readLocale(raw: unknown, fallback: LocaleSetting): LocaleSetting {
  return typeof raw === "string" && (LOCALES as readonly string[]).includes(raw)
    ? (raw as LocaleSetting)
    : fallback;
}

/**
 * Pure settings validation. Unknown keys are ignored, wrong types fall back to defaults and
 * numeric values are clamped to `LIMITS`. Never throws (even for throwing property getters).
 */
export function normalizeSettings(raw: Record<string, unknown>): Settings {
  const source: Record<string, unknown> =
    raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const defaults = DEFAULT_SETTINGS;

  const read = (key: string): unknown => {
    try {
      return source[key];
    } catch {
      return undefined;
    }
  };

  const numbers = {} as Record<NumericKey, number>;
  for (const key of Object.keys(NUMERIC_RULES) as NumericKey[]) {
    numbers[key] = clampNumber(read(key), defaults[key], NUMERIC_RULES[key]);
  }

  const booleans = {} as Record<BooleanKey, boolean>;
  for (const key of BOOLEAN_KEYS) {
    booleans[key] = readBoolean(read(key), defaults[key]);
  }

  return {
    enabled: booleans.enabled,
    maxEvents: numbers.maxEvents,
    maxDiffLines: numbers.maxDiffLines,
    contextLines: numbers.contextLines,
    debounceMs: numbers.debounceMs,
    persistHistory: booleans.persistHistory,
    trackFileOperations: booleans.trackFileOperations,
    trackExternalChanges: booleans.trackExternalChanges,
    trackTasks: booleans.trackTasks,
    trackDebug: booleans.trackDebug,
    trackTerminal: booleans.trackTerminal,
    excludeGlobs: readGlobs(read("excludeGlobs"), defaults.excludeGlobs),
    maxFileSizeKB: numbers.maxFileSizeKB,
    statusBar: booleans.statusBar,
    locale: readLocale(read("locale"), defaults.locale),
    openFilesOutsideWorkspace: booleans.openFilesOutsideWorkspace,
  };
}

const READ_KEYS: readonly string[] = [
  ...BOOLEAN_KEYS,
  ...(Object.keys(NUMERIC_RULES) as NumericKey[]),
  "excludeGlobs",
  "locale",
];

/** Reads `codetrail.*` from workspace configuration and validates it. */
export function readSettings(): Settings {
  try {
    const vscode = loadVscode();
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const raw: Record<string, unknown> = {};
    for (const key of READ_KEYS) {
      raw[key] = config.get<unknown>(key, DEFAULTS_BY_KEY[key]);
    }
    return normalizeSettings(raw);
  } catch {
    return fallbackSettings();
  }
}

function fallbackSettings(): Settings {
  return { ...DEFAULT_SETTINGS, excludeGlobs: [...DEFAULT_SETTINGS.excludeGlobs] };
}

/** Fires for any `codetrail.*` change; callers decide which keys are relevant. */
export function onSettingsChanged(cb: () => void): { dispose(): void } {
  try {
    const vscode = loadVscode();
    return vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) cb();
    });
  } catch {
    return { dispose: () => undefined };
  }
}
