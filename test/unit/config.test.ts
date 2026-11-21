import { describe, expect, it } from "vitest";
import { normalizeSettings } from "../../src/core/config";
import { DEFAULT_SETTINGS, LIMITS } from "../../src/shared/constants";

describe("normalizeSettings", () => {
  it("returns defaults for an empty object", () => {
    const settings = normalizeSettings({});
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.excludeGlobs).not.toBe(DEFAULT_SETTINGS.excludeGlobs);
  });

  it("keeps valid values unchanged", () => {
    const settings = normalizeSettings({
      enabled: false,
      maxEvents: 2500,
      maxDiffLines: 120,
      contextLines: 0,
      debounceMs: 500,
      persistHistory: false,
      trackFileOperations: false,
      trackExternalChanges: false,
      trackTasks: false,
      trackDebug: false,
      trackTerminal: false,
      excludeGlobs: ["**/vendor/**"],
      maxFileSizeKB: 512,
      statusBar: false,
      locale: "fa",
      openFilesOutsideWorkspace: true,
    });
    expect(settings).toEqual({
      enabled: false,
      maxEvents: 2500,
      maxDiffLines: 120,
      contextLines: 0,
      debounceMs: 500,
      persistHistory: false,
      trackFileOperations: false,
      trackExternalChanges: false,
      trackTasks: false,
      trackDebug: false,
      trackTerminal: false,
      excludeGlobs: ["**/vendor/**"],
      maxFileSizeKB: 512,
      statusBar: false,
      locale: "fa",
      openFilesOutsideWorkspace: true,
    });
  });

  it("clamps numeric values to LIMITS", () => {
    const low = normalizeSettings({
      maxEvents: 1,
      maxDiffLines: 0,
      contextLines: -5,
      debounceMs: 1,
      maxFileSizeKB: 1,
    });
    expect(low.maxEvents).toBe(LIMITS.maxEventsMin);
    expect(low.maxDiffLines).toBe(LIMITS.maxDiffLinesMin);
    expect(low.contextLines).toBe(0);
    expect(low.debounceMs).toBe(LIMITS.debounceMinMs);
    expect(low.maxFileSizeKB).toBe(64);

    const high = normalizeSettings({
      maxEvents: 1_000_000,
      maxDiffLines: 1_000_000,
      contextLines: 99,
      debounceMs: 60_000,
      maxFileSizeKB: 10_000_000,
    });
    expect(high.maxEvents).toBe(LIMITS.maxEventsMax);
    expect(high.maxDiffLines).toBe(LIMITS.maxDiffLinesMax);
    expect(high.contextLines).toBe(LIMITS.contextLinesMax);
    expect(high.debounceMs).toBe(LIMITS.debounceMaxMs);
    expect(high.maxFileSizeKB).toBe(65_536);
  });

  it("rounds non-integer numbers", () => {
    const settings = normalizeSettings({ maxEvents: 1200.6, debounceMs: 299.4 });
    expect(settings.maxEvents).toBe(1201);
    expect(settings.debounceMs).toBe(299);
  });

  it("falls back to defaults for wrong types and non-finite numbers", () => {
    const settings = normalizeSettings({
      enabled: "yes",
      maxEvents: "1500",
      maxDiffLines: Number.NaN,
      contextLines: Number.POSITIVE_INFINITY,
      debounceMs: null,
      maxFileSizeKB: {},
      trackTasks: 1,
      locale: 7,
      excludeGlobs: "**/*.log",
    });
    expect(settings.enabled).toBe(DEFAULT_SETTINGS.enabled);
    expect(settings.maxEvents).toBe(DEFAULT_SETTINGS.maxEvents);
    expect(settings.maxDiffLines).toBe(DEFAULT_SETTINGS.maxDiffLines);
    expect(settings.contextLines).toBe(DEFAULT_SETTINGS.contextLines);
    expect(settings.debounceMs).toBe(DEFAULT_SETTINGS.debounceMs);
    expect(settings.maxFileSizeKB).toBe(DEFAULT_SETTINGS.maxFileSizeKB);
    expect(settings.trackTasks).toBe(DEFAULT_SETTINGS.trackTasks);
    expect(settings.locale).toBe("auto");
    expect(settings.excludeGlobs).toEqual(DEFAULT_SETTINGS.excludeGlobs);
  });

  it("filters, trims and de-duplicates globs", () => {
    const settings = normalizeSettings({
      excludeGlobs: ["  **/vendor/**  ", "", "   ", 42, null, "**/vendor/**", "**/tmp/**"],
    });
    expect(settings.excludeGlobs).toEqual(["**/vendor/**", "**/tmp/**"]);
  });

  it("accepts an explicitly empty glob list", () => {
    expect(normalizeSettings({ excludeGlobs: [] }).excludeGlobs).toEqual([]);
  });

  it("accepts only locale enum members", () => {
    expect(normalizeSettings({ locale: "en" }).locale).toBe("en");
    expect(normalizeSettings({ locale: "fa" }).locale).toBe("fa");
    expect(normalizeSettings({ locale: "auto" }).locale).toBe("auto");
    expect(normalizeSettings({ locale: "fr" }).locale).toBe("auto");
    expect(normalizeSettings({ locale: "FA" }).locale).toBe("auto");
    expect(normalizeSettings({ locale: undefined }).locale).toBe("auto");
  });

  it("never throws on hostile input", () => {
    const hostile = {
      get enabled(): boolean {
        throw new Error("boom");
      },
    };
    expect(() => normalizeSettings(hostile)).not.toThrow();
    expect(() => normalizeSettings(null as unknown as Record<string, unknown>)).not.toThrow();
    expect(() => normalizeSettings([] as unknown as Record<string, unknown>)).not.toThrow();
  });

  it("ignores unknown keys", () => {
    const settings = normalizeSettings({ somethingElse: true, maxEvents: 200 });
    expect(settings.maxEvents).toBe(200);
    expect("somethingElse" in settings).toBe(false);
  });
});
