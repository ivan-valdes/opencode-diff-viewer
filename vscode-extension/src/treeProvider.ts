import * as vscode from "vscode";
import * as path from "path";
import type { EditSessionMeta, FileEntryMeta } from "./types";
import type { StorageManager } from "./storage";

// ─── Tree element union ───

export type TreeElement = WorkspaceGroupItem | EditSessionItem | FileChangeItem;

// ─── Workspace group (top-level when showing all workspaces) ───

export class WorkspaceGroupItem extends vscode.TreeItem {
  constructor(
    public readonly workspacePath: string,
    public readonly sessions: EditSessionMeta[]
  ) {
    const name = path.basename(workspacePath);
    super(name, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`;
    this.tooltip = workspacePath;
    this.contextValue = "workspaceGroup";
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

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
  private _showAllWorkspaces = false;

  constructor(storage: StorageManager, autoExpandLatest: boolean) {
    this.storage = storage;
    this.autoExpandLatest = autoExpandLatest;
  }

  get showAllWorkspaces(): boolean {
    return this._showAllWorkspaces;
  }

  setShowAllWorkspaces(value: boolean): void {
    this._showAllWorkspaces = value;
    this.refresh();
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
      const index = this.storage.getIndex();

      if (this._showAllWorkspaces) {
        // Group sessions by workspace path
        const groups = new Map<string, EditSessionMeta[]>();
        for (const session of index) {
          const wp = session.workspacePath;
          if (!groups.has(wp)) {
            groups.set(wp, []);
          }
          groups.get(wp)!.push(session);
        }
        // Return workspace group nodes sorted by most recent session
        return Array.from(groups.entries())
          .sort((a, b) => {
            const latestA = a[1][0]?.timestamp ?? 0;
            const latestB = b[1][0]?.timestamp ?? 0;
            return latestB - latestA;
          })
          .map(([wp, sessions]) => new WorkspaceGroupItem(wp, sessions));
      }

      // Default: filter to current workspace only
      const folders = vscode.workspace.workspaceFolders ?? [];
      const folderPaths = new Set(folders.map((f) => f.uri.fsPath));

      const filtered = index.filter((session) => folderPaths.has(session.workspacePath));

      return filtered.map((session, i) => {
        const item = new EditSessionItem(session);
        if (i === 0 && this.autoExpandLatest) {
          item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        }
        return item;
      });
    }

    if (element instanceof WorkspaceGroupItem) {
      return element.sessions.map((session, i) => {
        const item = new EditSessionItem(session);
        if (i === 0 && this.autoExpandLatest) {
          item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
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
