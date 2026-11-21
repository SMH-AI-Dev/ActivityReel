import * as vscode from "vscode";
import { STORAGE_FILE } from "../../shared/constants";
import type { StorageAdapter } from "./historyPersistence";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * `StorageAdapter` backed by `vscode.workspace.fs`.
 *
 * Writes go to `${file}.tmp` and are renamed over the target (`overwrite: true`); if the rename
 * fails the text is written directly. When no storage URI is available every method is a no-op.
 */
export class VscodeStorageAdapter implements StorageAdapter {
  private readonly folder: vscode.Uri | undefined;
  private readonly file: vscode.Uri | undefined;

  constructor(folder: vscode.Uri | undefined, fileName: string = STORAGE_FILE) {
    this.folder = folder;
    this.file = folder ? vscode.Uri.joinPath(folder, fileName) : undefined;
  }

  async read(): Promise<string | undefined> {
    const file = this.file;
    if (!file) return undefined;
    try {
      const data = await vscode.workspace.fs.readFile(file);
      return decoder.decode(data);
    } catch {
      return undefined;
    }
  }

  async write(text: string): Promise<void> {
    const file = this.file;
    const folder = this.folder;
    if (!file || !folder) return;
    await vscode.workspace.fs.createDirectory(folder);
    const data = encoder.encode(text);
    const temp = vscode.Uri.joinPath(folder, `${file.path.slice(file.path.lastIndexOf("/") + 1)}.tmp`);
    let renamed = false;
    try {
      await vscode.workspace.fs.writeFile(temp, data);
      await vscode.workspace.fs.rename(temp, file, { overwrite: true });
      renamed = true;
    } catch {
      renamed = false;
    }
    if (renamed) return;
    await vscode.workspace.fs.writeFile(file, data);
  }

  async remove(): Promise<void> {
    const file = this.file;
    if (!file) return;
    try {
      await vscode.workspace.fs.delete(file, { useTrash: false });
    } catch {
      // Missing file is not an error.
    }
  }

  /** Best effort: copies the current file aside as `codetrail-activity.corrupt-<timestamp>.json`. */
  async quarantine(): Promise<void> {
    const file = this.file;
    const folder = this.folder;
    if (!file || !folder) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = vscode.Uri.joinPath(folder, `codetrail-activity.corrupt-${stamp}.json`);
    try {
      const data = await vscode.workspace.fs.readFile(file);
      await vscode.workspace.fs.writeFile(target, data);
    } catch (error) {
      console.warn(`CodeTrail: could not quarantine activity history (${errorMessage(error)}).`);
    }
  }
}
