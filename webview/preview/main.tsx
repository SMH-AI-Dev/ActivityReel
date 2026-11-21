/**
 * Preview shell (dev server only, never bundled into the extension). Reads the surface, locale
 * and theme from the query string, injects the bootstrap the extension host normally provides
 * (`window.__CODETRAIL__`), and mounts the shared app.
 *
 *   /?surface=panel|sidebar|about&locale=en|fa&theme=dark|light|hc|hc-light&motion=reduced
 */
import { createRoot } from "react-dom/client";
import { App } from "../src/App";
import "../src/styles/global.css";
import "./preview.css";

const params = new URLSearchParams(window.location.search);
const surfaceParam = params.get("surface");
const surface = surfaceParam === "sidebar" || surfaceParam === "about" ? surfaceParam : "panel";
const locale = params.get("locale") === "fa" ? "fa" : "en";
const theme = params.get("theme") ?? "dark";

window.__CODETRAIL__ = { surface, locale };

document.documentElement.setAttribute("dir", locale === "fa" ? "rtl" : "ltr");
document.documentElement.setAttribute("lang", locale);
const themeClass =
  theme === "light"
    ? "vscode-light"
    : theme === "hc"
      ? "vscode-high-contrast"
      : theme === "hc-light"
        ? "vscode-high-contrast-light"
        : "vscode-dark";
for (const el of [document.documentElement, document.body]) {
  el.classList.remove("vscode-dark", "vscode-light", "vscode-high-contrast", "vscode-high-contrast-light");
  el.classList.add(themeClass);
}
if (params.get("motion") === "reduced") document.body.classList.add("vscode-reduce-motion");
document.body.dataset.surface = surface;

const shell = document.createElement("div");
shell.id = "shell";
shell.className = "preview-shell";
const frame = document.createElement("div");
frame.className = "preview-frame";
const root = document.createElement("div");
root.className = "preview-root";
frame.appendChild(root);
shell.appendChild(frame);
document.body.appendChild(shell);
if (surface === "sidebar") frame.style.width = params.get("width") ?? "320px";

createRoot(root).render(<App initialSurface={surface} />);
