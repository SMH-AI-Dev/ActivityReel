/**
 * Webview entry point. One IIFE bundle serves all three surfaces; the surface and locale are
 * injected at bootstrap (`window.__ACTIVITYREEL__ = { surface, locale }`), never by URL parsing.
 */
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";

type SurfaceHint = "panel" | "sidebar" | "about";

function readBootstrap(): { surface: SurfaceHint; locale?: string } {
  const raw = window.__ACTIVITYREEL__;
  const surface = raw?.surface;
  return {
    surface: surface === "sidebar" || surface === "about" ? surface : "panel",
    locale: typeof raw?.locale === "string" ? raw.locale : undefined,
  };
}

function boot(): void {
  const container = document.getElementById("root");
  if (!container) return;
  const { surface, locale } = readBootstrap();
  document.body.dataset.surface = surface;
  document.documentElement.setAttribute("dir", locale === "fa" ? "rtl" : "ltr");
  document.documentElement.setAttribute("lang", locale === "fa" ? "fa" : "en");
  createRoot(container).render(<App initialSurface={surface} />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

export {};
