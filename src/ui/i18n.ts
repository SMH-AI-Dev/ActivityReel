import type { Direction, LocaleSetting, ResolvedLocale } from "../shared/model";

/**
 * Host-side strings. The locale setting wins over the VS Code UI language, so the extension
 * host cannot rely on `vscode.l10n.t` for user-facing text.
 */
const EN = {
  paused: "ActivityReel paused.",
  resumed: "ActivityReel resumed.",
  pausedQuestion: "ActivityReel is paused. Resume tracking?",
  cleared: "Activity history cleared.",
  clearQuestion: "Clear all ActivityReel activity? This cannot be undone.",
  clear: "Clear",
  cancel: "Cancel",
  exportJson: "Export activity as JSON",
  exportMarkdown: "Export activity as Markdown",
  exported: "Activity exported to {0}",
  nothingToExport: "No activity to export yet.",
  exportFailed: "Export failed: {0}",
  copied: "Copied to clipboard.",
  diffExpired: "The diff is no longer retained.",
  openFailed: "Could not open this file.",
  pausedShort: "Paused",
  events: "events",
  files: "files",
  added: "added",
  removed: "removed",
  aboutTitle: "About ActivityReel",
  panelTitle: "ActivityReel",
} as const;

export type HostStringKey = keyof typeof EN;

const FA: Record<HostStringKey, string> = {
  paused: "ActivityReel متوقف شد.",
  resumed: "ActivityReel از سر گرفته شد.",
  pausedQuestion: "ActivityReel متوقف شده است. رهگیری از سر گرفته شود؟",
  cleared: "تاریخچه فعالیت پاک شد.",
  clearQuestion: "همه فعالیت‌های ActivityReel پاک شود؟ این کار قابل بازگشت نیست.",
  clear: "پاک کردن",
  cancel: "لغو",
  exportJson: "خروجی فعالیت به صورت JSON",
  exportMarkdown: "خروجی فعالیت به صورت Markdown",
  exported: "فعالیت در {0} ذخیره شد.",
  nothingToExport: "هنوز فعالیتی برای خروجی گرفتن وجود ندارد.",
  exportFailed: "خروجی گرفتن ناموفق بود: {0}",
  copied: "در کلیپ‌بورد کپی شد.",
  diffExpired: "این تفاوت دیگر نگه‌داری نمی‌شود.",
  openFailed: "باز کردن این فایل ممکن نبود.",
  pausedShort: "متوقف",
  events: "رویداد",
  files: "فایل",
  added: "افزوده",
  removed: "حذف‌شده",
  aboutTitle: "درباره ActivityReel",
  panelTitle: "ActivityReel",
};

export function resolveLocale(setting: LocaleSetting, language: string): ResolvedLocale {
  if (setting === "fa" || setting === "en") return setting;
  return language.toLowerCase().startsWith("fa") ? "fa" : "en";
}

export function directionForLocale(locale: ResolvedLocale): Direction {
  return locale === "fa" ? "rtl" : "ltr";
}

export function hostString(
  locale: ResolvedLocale,
  key: HostStringKey,
  ...args: readonly (string | number)[]
): string {
  const template = (locale === "fa" ? FA : EN)[key];
  if (args.length === 0) return template;
  return template.replace(/\{(\d+)\}/g, (_match, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? "" : String(value);
  });
}
