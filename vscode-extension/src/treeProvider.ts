import * as vscode from "vscode";
import type { EditSessionMeta, FileEntryMeta } from "./types";
import type { StorageManager } from "./storage";
import { DiffContentProvider } from "./diffProvider";

// ─── Tree element union ───

export type TreeElement = EditSessionItem | FileChangeItem;

// ─── Edit session (root-level node) ───

export class EditSessionItem extends vscode.TreeItem {
  constructor(public readonly session: EditSessionMeta) {
    const time = new Date(session.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const fileCount = session.files.length;
    const adds = session.totalAdditions;
    const dels = session.totalDeletions;
    const label = `${time} - ${session.promptSummary}`;
    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    this.description = `${fileCount} file${fileCount !== 1 ? "s" : ""}, +${adds} -${dels}`;
    this.tooltip = new vscode.MarkdownString(
      `**Prompt:** ${session.prompt}\n\n` +
        `**Time:** ${new Date(session.timestamp).toLocaleString()}\n\n` +
        `**Files:** ${fileCount} | **+${adds} -${dels}**` +
        (session.reverted ? "\n\n*(reverted)*" : "")
    );
    this.contextValue = session.reverted
      ? "editSession-reverted"
      : "editSession";
    this.iconPath = new vscode.ThemeIcon(
      session.reverted ? "discard" : "git-commit",
      session.reverted
        ? new vscode.ThemeColor("disabledForeground")
        : undefined
    );
  }
}

// ─── File change (child node) ───

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  modified: { icon: "diff-modified", color: "gitDecoration.modifiedResourceForeground" },
  added: { icon: "diff-added", color: "gitDecoration.untrackedResourceForeground" },
  deleted: { icon: "diff-removed", color: "gitDecoration.deletedResourceForeground" },
};

export class FileChangeItem extends vscode.TreeItem {
  constructor(
    public readonly file: FileEntryMeta,
    public readonly session: EditSessionMeta
  ) {
    super(file.relativePath, vscode.TreeItemCollapsibleState.None);

    const info = STATUS_ICONS[file.status] ?? STATUS_ICONS.modified;
    this.iconPath = new vscode.ThemeIcon(
      info.icon,
      new vscode.ThemeColor(info.color)
    );
    this.description = `+${file.additions} -${file.deletions}`;
    this.tooltip = `${file.filePath}\nStatus: ${file.status}`;
    this.contextValue = session.reverted
      ? "fileChange-reverted"
      : "fileChange";

    // Click opens diff
    this.command = {
      command: "opencode-diff-viewer.viewDiff",
      title: "View Diff",
      arguments: [session.id, file.filePath, file.relativePath, session.promptSummary],
    };
  }
}

// ─── TreeDataProvider ───

export class EditTreeDataProvider
  implements vscode.TreeDataProvider<TreeElement>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeElement | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private storage: StorageManager;
  private autoExpandLatest: boolean;

  constructor(storage: StorageManager, autoExpandLatest: boolean) {
    this.storage = storage;
    this.autoExpandLatest = autoExpandLatest;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setAutoExpandLatest(value: boolean): void {
    this.autoExpandLatest = value;
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) {
      // Root: list sessions
      const index = this.storage.getIndex();
      return index.map((session, i) => {
        const item = new EditSessionItem(session);
        // Auto-expand latest session
        if (i === 0 && this.autoExpandLatest) {
          item.collapsibleState =
            vscode.TreeItemCollapsibleState.Expanded;
        }
        return item;
      });
    }

    if (element instanceof EditSessionItem) {
      return element.session.files.map(
        (f) => new FileChangeItem(f, element.session)
      );
    }

    return [];
  }
}
