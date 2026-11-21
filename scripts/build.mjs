import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build as viteBuild } from "vite";
import { buildExtension } from "../esbuild.config.mjs";

const root = resolve(import.meta.dirname, "..");
const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function reportWebviewSize() {
  const file = resolve(root, "media/webview/main.js");
  try {
    const [bytes, info] = await Promise.all([readFile(file), stat(file)]);
    const gzip = gzipSync(bytes).byteLength;
    console.log(
      `webview: ${(info.size / 1024).toFixed(1)} KiB raw, ${(gzip / 1024).toFixed(1)} KiB gzip`,
    );
    if (production && gzip > 160 * 1024) {
      throw new Error(`Webview bundle exceeds 160 KiB gzip (${(gzip / 1024).toFixed(1)} KiB)`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("exceeds")) {
      throw error;
    }
    console.warn("webview: size report skipped", error);
  }
}

const esbuildContext = await buildExtension({ production, watch });

await viteBuild({
  configFile: resolve(root, "vite.config.mts"),
  build: watch ? { watch: {} } : {},
  logLevel: "info",
});

if (!watch) {
  await reportWebviewSize();
  await esbuildContext?.dispose();
}
