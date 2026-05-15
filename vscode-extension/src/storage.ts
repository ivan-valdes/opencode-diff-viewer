import * as vscode from "vscode";
import * as path from "path";
import type {
  EditNotification,
  EditSessionMeta,
  FileEntryMeta,
  StoredEditSession,
  StoredFileChange,
} from "./types";

const INDEX_FILE = "index.json";
const SESSIONS_DIR = "sessions";

export class StorageManager {
  private storageUri: vscode.Uri;
  private sessionsUri: vscode.Uri;
  private indexUri: vscode.Uri;
  private index: EditSessionMeta[] = [];
  private maxHistory: number;

  constructor(globalStorageUri: vscode.Uri, maxHistory: number) {
    this.storageUri = globalStorageUri;
    this.sessionsUri = vscode.Uri.joinPath(globalStorageUri, SESSIONS_DIR);
    this.indexUri = vscode.Uri.joinPath(globalStorageUri, INDEX_FILE);
    this.maxHistory = maxHistory;
  }

  async init(): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(this.sessionsUri);
    } catch {
      // already exists
    }
    await this.loadIndex();
  }

  /** Load the lightweight index from disk */
  async loadIndex(): Promise<EditSessionMeta[]> {
    try {
      const data = await vscode.workspace.fs.readFile(this.indexUri);
      this.index = JSON.parse(Buffer.from(data).toString("utf-8"));
    } catch {
      this.index = [];
    }
    return this.index;
  }

  /** Get the current in-memory index */
  getIndex(): EditSessionMeta[] {
    return this.index;
  }

  /** Persist the index to disk */
  private async saveIndex(): Promise<void> {
    const data = Buffer.from(JSON.stringify(this.index, null, 2), "utf-8");
    await vscode.workspace.fs.writeFile(this.indexUri, data);
  }

  /**
   * Store a new edit session. Matches incoming file changes against open
   * workspace folders — only files inside a workspace folder are stored.
   * Returns the stored meta (or null if nothing matched).
   */
  async saveSession(
    notification: EditNotification
  ): Promise<EditSessionMeta | null> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return null;
    }

    const storedChanges: StoredFileChange[] = [];

    for (const change of notification.changes) {
      const absPath = change.filePath;
      for (const folder of folders) {
        const folderPath = folder.uri.fsPath;
        if (
          absPath === folderPath ||
          absPath.startsWith(folderPath + path.sep)
        ) {
          storedChanges.push({
            filePath: absPath,
            relativePath: path.relative(folderPath, absPath),
            workspaceFolder: folderPath,
            status: change.status,
            additions: change.additions,
            deletions: change.deletions,
            before: change.before,
            after: change.after,
          });
          break; // a file belongs to one workspace folder only
        }
      }
    }

    if (storedChanges.length === 0) {
      return null;
    }

    // Build metadata entry
    const meta: EditSessionMeta = {
      id: notification.id,
      prompt: notification.prompt,
      promptSummary: notification.promptSummary,
      timestamp: notification.timestamp,
      workspacePath: notification.workspacePath,
      sessionId: notification.sessionId,
      reverted: false,
      totalAdditions: storedChanges.reduce((s, c) => s + c.additions, 0),
      totalDeletions: storedChanges.reduce((s, c) => s + c.deletions, 0),
      files: storedChanges.map(
        (c): FileEntryMeta => ({
          filePath: c.filePath,
          relativePath: c.relativePath,
          workspaceFolder: c.workspaceFolder,
          status: c.status,
          additions: c.additions,
          deletions: c.deletions,
        })
      ),
    };

    // Save full data (with before/after) to its own file
    const full: StoredEditSession = { ...meta, changes: storedChanges };
    const sessionUri = vscode.Uri.joinPath(
      this.sessionsUri,
      `${notification.id}.json`
    );
    await vscode.workspace.fs.writeFile(
      sessionUri,
      Buffer.from(JSON.stringify(full, null, 2), "utf-8")
    );

    // Add to index (newest first)
    this.index.unshift(meta);

    // Enforce max history
    while (this.index.length > this.maxHistory) {
      const removed = this.index.pop()!;
      const removedUri = vscode.Uri.joinPath(
        this.sessionsUri,
        `${removed.id}.json`
      );
      try {
        await vscode.workspace.fs.delete(removedUri);
      } catch {
        // file may already be gone
      }
    }

    await this.saveIndex();
    return meta;
  }

  /** Load full session data (including before/after content) */
  async loadSessionFull(id: string): Promise<StoredEditSession | null> {
    try {
      const uri = vscode.Uri.joinPath(this.sessionsUri, `${id}.json`);
      const data = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(data).toString("utf-8"));
    } catch {
      return null;
    }
  }

  /** Mark a session as reverted */
  async markReverted(id: string): Promise<void> {
    const entry = this.index.find((s) => s.id === id);
    if (entry) {
      entry.reverted = true;
      await this.saveIndex();
    }
  }

  /** Delete a single session */
  async deleteSession(id: string): Promise<void> {
    this.index = this.index.filter((s) => s.id !== id);
    const uri = vscode.Uri.joinPath(this.sessionsUri, `${id}.json`);
    try {
      await vscode.workspace.fs.delete(uri);
    } catch {
      // already gone
    }
    await this.saveIndex();
  }

  /** Clear all sessions (optionally filtered by workspacePath) */
  async clearAll(workspacePath?: string): Promise<number> {
    let toRemove: EditSessionMeta[];
    if (workspacePath) {
      toRemove = this.index.filter((s) =>
        s.files.some((f) => f.filePath.startsWith(workspacePath))
      );
      this.index = this.index.filter(
        (s) => !toRemove.includes(s)
      );
    } else {
      toRemove = [...this.index];
      this.index = [];
    }

    for (const s of toRemove) {
      const uri = vscode.Uri.joinPath(this.sessionsUri, `${s.id}.json`);
      try {
        await vscode.workspace.fs.delete(uri);
      } catch {
        // ignore
      }
    }

    await this.saveIndex();
    return toRemove.length;
  }
}
