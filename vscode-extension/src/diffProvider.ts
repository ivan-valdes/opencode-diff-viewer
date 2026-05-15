import * as vscode from "vscode";
import type { StorageManager } from "./storage";

/**
 * Virtual-document content provider for the `opencode-diff` URI scheme.
 *
 * URIs follow the pattern:
 *   opencode-diff://before/<editId>/<absoluteFilePath>
 *   opencode-diff://after/<editId>/<absoluteFilePath>
 *
 * The authority is "before" or "after", the path is "/<editId>/<filePath>".
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private storage: StorageManager;
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(storage: StorageManager) {
    this.storage = storage;
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const side = uri.authority; // "before" | "after"
    // path = /<editId>/<absoluteFilePath>
    const rawPath = uri.path;
    const firstSlash = rawPath.indexOf("/", 1);
    if (firstSlash === -1) {
      return "";
    }
    const editId = rawPath.substring(1, firstSlash);
    const filePath = rawPath.substring(firstSlash + 1);

    const session = await this.storage.loadSessionFull(editId);
    if (!session) {
      return `// Session ${editId} not found`;
    }

    const change = session.changes.find((c) => c.filePath === filePath);
    if (!change) {
      return `// File ${filePath} not found in session ${editId}`;
    }

    if (side === "before") {
      return change.before ?? "";
    }
    return change.after ?? "";
  }

  /**
   * Open the native VSCode diff editor for a file change.
   *
   * @param editId  The session ID
   * @param filePath  Absolute path of the changed file
   * @param label  Title for the diff tab
   */
  static async openDiff(
    editId: string,
    filePath: string,
    label: string
  ): Promise<void> {
    const encodedPath = `/${editId}/${filePath}`;
    const beforeUri = vscode.Uri.parse(
      `opencode-diff://before${encodedPath}`
    );
    const afterUri = vscode.Uri.parse(
      `opencode-diff://after${encodedPath}`
    );

    await vscode.commands.executeCommand(
      "vscode.diff",
      beforeUri,
      afterUri,
      label
    );
  }
}
