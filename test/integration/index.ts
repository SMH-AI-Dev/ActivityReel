import * as assert from "node:assert/strict";
import * as vscode from "vscode";

const EXTENSION_ID = "smh-dev-ai.codetrail";
const PUBLIC_COMMANDS = [
  "codetrail.open",
  "codetrail.togglePause",
  "codetrail.clear",
  "codetrail.exportJson",
  "codetrail.exportMarkdown",
  "codetrail.about",
];

interface TestEvent {
  kind: string;
  relPath?: string;
}

interface TestSnapshot {
  paused: boolean;
  events: TestEvent[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  description: string,
  read: () => Promise<T | undefined>,
  accept: (value: T) => boolean,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (last !== undefined && accept(last)) {
      return last;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(last)}`);
}

async function snapshot(): Promise<TestSnapshot> {
  return vscode.commands.executeCommand<TestSnapshot>("codetrail.__test.snapshot");
}

export async function run(): Promise<void> {
  console.log("CodeTrail integration: start");
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `extension ${EXTENSION_ID} should be installed`);
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const id of PUBLIC_COMMANDS) {
    assert.ok(commands.includes(id), `command ${id} should be registered`);
  }
  assert.ok(
    commands.includes("codetrail.__test.snapshot"),
    "test snapshot command should exist in test mode",
  );

  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "fixture workspace should be open");
  const uri = vscode.Uri.joinPath(folder.uri, "sample.ts");
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);

  const before = await snapshot();
  assert.equal(typeof before.paused, "boolean");

  await editor.edit((builder) => {
    builder.insert(new vscode.Position(0, 0), "// codetrail integration probe\n");
  });

  await waitFor(
    "edit event",
    snapshot,
    (state) => state.events.some((event) => event.kind === "edit" && event.relPath?.includes("sample.ts")),
  );

  await document.save();
  await waitFor(
    "save event",
    snapshot,
    (state) => state.events.some((event) => event.kind === "save" && event.relPath?.includes("sample.ts")),
  );

  const createdUri = vscode.Uri.joinPath(folder.uri, "created-by-test.ts");
  await vscode.workspace.fs.writeFile(createdUri, new TextEncoder().encode("export const x = 1;\n"));
  await waitFor(
    "file create event",
    snapshot,
    (state) => state.events.some((event) => event.kind === "file-create" && event.relPath?.includes("created-by-test.ts")),
  );
  await vscode.workspace.fs.delete(createdUri);
  await waitFor(
    "file delete event",
    snapshot,
    (state) => state.events.some((event) => event.kind === "file-delete" && event.relPath?.includes("created-by-test.ts")),
  );

  await vscode.commands.executeCommand("codetrail.togglePause");
  const paused = await snapshot();
  assert.equal(paused.paused, true, "pause command should pause tracking");
  await vscode.commands.executeCommand("codetrail.togglePause");
  const resumed = await snapshot();
  assert.equal(resumed.paused, false, "pause command should resume tracking");
  console.log("CodeTrail integration: all checks passed");
}
