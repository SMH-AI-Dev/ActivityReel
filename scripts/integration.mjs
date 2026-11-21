import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { build } from "esbuild";
import { runTests } from "@vscode/test-electron";

const root = resolve(import.meta.dirname, "..");
const testsOut = resolve(root, "dist-test/integration/index.js");
const fixture = resolve(root, "test/integration/fixtures/workspace");

const buildStep = spawnSync(process.execPath, ["scripts/build.mjs", "--production"], {
  cwd: root,
  stdio: "inherit",
});
if (buildStep.status !== 0) {
  process.exit(buildStep.status ?? 1);
}

await build({
  entryPoints: [resolve(root, "test/integration/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: ["node20"],
  external: ["vscode", "mocha"],
  outfile: testsOut,
  logLevel: "info",
});

const launchArgs = [
  fixture,
  "--disable-extensions",
  "--disable-gpu",
  "--skip-welcome",
  "--skip-release-notes",
];

const executable = process.env.VSCODE_EXECUTABLE_PATH;
const version = process.env.VSCODE_TEST_VERSION ?? "1.93.0";

await runTests({
  extensionDevelopmentPath: root,
  extensionTestsPath: testsOut,
  launchArgs,
  ...(executable ? { vscodeExecutablePath: executable } : { version }),
});
