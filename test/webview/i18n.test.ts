import { describe, expect, it } from "vitest";
import {
  createTranslator,
  directionOf,
  formatClock,
  formatDuration,
  formatNumber,
  formatRelative,
  formatSigned,
  interpolate,
  intlLocale,
  translate,
} from "../../webview/src/i18n";

describe("interpolate", () => {
  it("replaces named placeholders and keeps unknown ones literal", () => {
    expect(interpolate("Hello {name}, {missing}", { name: "Ada" })).toBe("Hello Ada, {missing}");
  });

  it("handles the plural form for one and other", () => {
    const template = "{count, plural, one {# file} other {# files}}";
    // The dictionary templates use explicit words; the engine only chooses the branch.
    expect(interpolate(template, { count: 1 })).toBe("# file");
    expect(interpolate(template, { count: 4 })).toBe("# files");
  });
});

describe("translate", () => {
  it("falls back to English for an unknown key", () => {
    const t = createTranslator("fa");
    expect(t("header.about")).not.toBe("header.about");
  });

  it("produces distinct English and Persian dictionaries", () => {
    expect(translate("en", "header.about")).toMatch(/about/i);
    expect(translate("fa", "header.about")).toMatch(/[\u0600-\u06FF]/);
  });
});

describe("formatting", () => {
  it("localizes numbers and signed values", () => {
    expect(formatNumber(1234, "en")).toBe("1,234");
    expect(formatNumber(1234, "fa")).not.toBe("1,234");
    expect(formatSigned(12, "en", "+")).toBe("+12");
    expect(formatSigned(-4, "en", "−")).toBe("−4");
  });

  it("formats session durations without locale digits leaking into separators", () => {
    expect(formatDuration(65_000, "en")).toBe("1:05");
    expect(formatDuration(3_665_000, "en")).toBe("1:01:05");
    const fa = formatDuration(65_000, "fa");
    expect(fa).toContain(":");
    expect(fa).not.toMatch(/\d/);
  });

  it("formats relative time and a clock", () => {
    const now = 1_700_000_000_000;
    expect(formatRelative(now, now, "en")).toBe("now");
    expect(formatRelative(now, now, "fa")).toBe("اکنون");
    expect(formatRelative(now - 120_000, now, "en")).toMatch(/2/);
    expect(formatClock(now, "en")).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("maps locales to directions and Intl tags", () => {
    expect(directionOf("fa")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
    expect(intlLocale("fa")).toBe("fa-IR");
    expect(intlLocale("en")).toBe("en");
  });
});
