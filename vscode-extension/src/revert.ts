import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { StorageManager } from "./storage";
import type { StoredFileChange } from "./types";

/**
 * Revert a single file change to its "before" state.
 */
export async function revertFile(
  change: StoredFileChange
): Promise<boolean> {
  const filePath = change.filePath;

  switch (change.status) {
    case "modified": {
      // Restore previous content
      if (change.before === undefined) {
        vscode.window.showWarningMessage(
          `Cannot revert ${change.relativePath}: no previous content stored.`
        );
        return false;
      }
      fs.writeFileSync(filePath, change.before, "utf-8");
      return true;
    }
    case "added": {
      // Delete the file that was added
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        // Remove empty parent directories up to the workspace folder
        let dir = path.dirname(filePath);
        const wsFolder = change.workspaceFolder;
        while (dir !== wsFolder && dir.startsWith(wsFolder)) {
          try {
            const entries = fs.readdirSync(dir);
            if (entries.length === 0) {
              fs.rmdirSync(dir);
              dir = path.dirname(dir);
            } else {
              break;
            }
          } catch {
            break;
          }
        }
      }
      return true;
    }
    case "deleted": {
      // Recreate the file with its previous content
      if (change.before === undefined) {
        vscode.window.showWarningMessage(
          `Cannot revert ${change.relativePath}: no previous content stored.`
        );
        return false;
      }
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, change.before, "utf-8");
      return true;
    }
    default:
      return false;
  }
}

/**
 * Revert a single file with confirmation dialog.
 */
export async function revertFileWithConfirm(
  storage: StorageManager,
  sessionId: string,
  filePath: string
): Promise<boolean> {
  const session = await storage.loadSessionFull(sessionId);
  if (!session) {
    vscode.window.showErrorMessage("Session not found.");
    return false;
  }

  const change = session.changes.find((c) => c.filePath === filePath);
  if (!change) {
    vscode.window.showErrorMessage("File change not found in session.");
    return false;
  }

  const action = actionLabel(change.status);
  const confirm = await vscode.window.showWarningMessage(
    `Revert ${change.relativePath}? This will ${action}.`,
    { modal: true },
    "Revert"
  );

  if (confirm !== "Revert") {
    return false;
  }

  const ok = await revertFile(change);
  if (ok) {
    vscode.window.showInformationMessage(
      `Reverted ${change.relativePath}.`
    );
  }
  return ok;
}

/**
 * Revert all files in a session with confirmation dialog.
 */
export async function revertSessionWithConfirm(
  storage: StorageManager,
  sessionId: string
): Promise<boolean> {
  const session = await storage.loadSessionFull(sessionId);
  if (!session) {
    vscode.window.showErrorMessage("Session not found.");
    return false;
  }

  const lines = session.changes.map(
    (c) => `  ${statusChar(c.status)} ${c.relativePath}`
  );
  const summary = `Revert ${session.changes.length} file(s)?\n\n${lines.join("\n")}`;

  const confirm = await vscode.window.showWarningMessage(
    summary,
    { modal: true },
    "Revert All"
  );

  if (confirm !== "Revert All") {
    return false;
  }

  let reverted = 0;
  // Revert in reverse order (undo last change first)
  for (const change of [...session.changes].reverse()) {
    const ok = await revertFile(change);
    if (ok) {
      reverted++;
    }
  }

  await storage.markReverted(sessionId);
  vscode.window.showInformationMessage(
    `Reverted ${reverted}/${session.changes.length} files.`
  );
  return true;
}

function statusChar(status: string): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    default:
      return "?";
  }
}

function actionLabel(status: string): string {
  switch (status) {
    case "modified":
      return "restore the previous content";
    case "added":
      return "delete this file";
    case "deleted":
      return "recreate this file with its previous content";
    default:
      return "revert this change";
  }
}
