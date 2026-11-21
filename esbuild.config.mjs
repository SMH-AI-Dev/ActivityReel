import { build, context } from "esbuild";

export const extensionBuildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: ["node20"],
  external: ["vscode"],
  sourcesContent: false,
  logLevel: "info",
};

export async function buildExtension({ production, watch }) {
  const options = {
    ...extensionBuildOptions,
    minify: production,
    sourcemap: production ? false : "inline",
  };
  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    return ctx;
  }
  await build(options);
  return undefined;
}
