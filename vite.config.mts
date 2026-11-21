import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig({
  root: resolve(root, "webview"),
  base: "./",
  publicDir: false,
  build: {
    outDir: resolve(root, "media/webview"),
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    sourcemap: false,
    modulePreload: false,
    reportCompressedSize: true,
    rollupOptions: {
      input: resolve(root, "webview/src/main.tsx"),
      output: {
        format: "iife",
        name: "ActivityReelWebview",
        entryFileNames: "main.js",
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css") ? "main.css" : "assets/[name][extname]",
      },
      onwarn(warning, warn) {
        // IIFE output makes Vite's preload helper dead code; its `import.meta` probe is
        // irrelevant, so do not fail the build log on it.
        if (warning.code === "EMPTY_IMPORT_META") return;
        warn(warning);
      },
    },
  },
});
