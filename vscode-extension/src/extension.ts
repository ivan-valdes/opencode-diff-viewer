import * as vscode from "vscode";
import * as http from "http";
import type {
  EditNotification,
  StatusResponse,
  NotifyResponse,
  ClearResponse,
} from "./types";
import { StorageManager } from "./storage";
import { DiffContentProvider } from "./diffProvider";
import { EditTreeDataProvider, EditSessionItem, FileChangeItem } from "./treeProvider";
import {
  revertFileWithConfirm,
  revertSessionWithConfirm,
} from "./revert";

const EXTENSION_ID = "opencode.opencode-diff-viewer";
const MAX_BODY = 10 * 1024 * 1024; // 10 MB

let server: http.Server | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration("opencode-diff-viewer");
  const port = config.get<number>("port", 19877);
  const maxHistory = config.get<number>("maxSessionHistory", 50);
  const autoExpandLatest = config.get<boolean>("autoExpandLatest", true);

  // ─── Storage ───
  const storage = new StorageManager(context.globalStorageUri, maxHistory);
  await storage.init();

  // ─── Diff content provider ───
  const diffProvider = new DiffContentProvider(storage);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "opencode-diff",
      diffProvider
    )
  );

  // ─── Tree view ───
  const treeProvider = new EditTreeDataProvider(storage, autoExpandLatest);
  const treeView = vscode.window.createTreeView(
    "opencode-diff-viewer.editsPanel",
    {
      treeDataProvider: treeProvider,
      showCollapseAll: true,
    }
  );
  context.subscriptions.push(treeView);

  // Update badge with session count
  const updateBadge = () => {
    const count = storage.getIndex().length;
    treeView.badge =
      count > 0 ? { value: count, tooltip: `${count} edit sessions` } : undefined;
  };
  updateBadge();

  // ─── Commands ───

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "opencode-diff-viewer.viewDiff",
      async (
        editId: string,
        filePath: string,
        relativePath: string,
        promptSummary: string
      ) => {
        await DiffContentProvider.openDiff(
          editId,
          filePath,
          `${relativePath} (${promptSummary})`
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "opencode-diff-viewer.revertFile",
      async (item: FileChangeItem) => {
        const ok = await revertFileWithConfirm(
          storage,
          item.session.id,
          item.file.filePath
        );
        if (ok) {
          treeProvider.refresh();
          updateBadge();
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "opencode-diff-viewer.revertSession",
      async (item: EditSessionItem) => {
        const ok = await revertSessionWithConfirm(storage, item.session.id);
        if (ok) {
          treeProvider.refresh();
          updateBadge();
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "opencode-diff-viewer.deleteSession",
      async (item: EditSessionItem) => {
        const confirm = await vscode.window.showWarningMessage(
          `Delete session "${item.session.promptSummary}" from history?`,
          { modal: true },
          "Delete"
        );
        if (confirm !== "Delete") {
          return;
        }
        await storage.deleteSession(item.session.id);
        treeProvider.refresh();
        updateBadge();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "opencode-diff-viewer.clearAll",
      async () => {
        const confirm = await vscode.window.showWarningMessage(
          "Clear all edit history?",
          { modal: true },
          "Clear All"
        );
        if (confirm !== "Clear All") {
          return;
        }
        await storage.clearAll();
        treeProvider.refresh();
        updateBadge();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "opencode-diff-viewer.refresh",
      async () => {
        await storage.loadIndex();
        treeProvider.refresh();
        updateBadge();
      }
    )
  );

  // ─── HTTP Server ───

  server = http.createServer(async (req, res) => {
    const sendJson = (status: number, body: unknown) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(payload);
    };

    // GET /status
    if (req.method === "GET" && req.url === "/status") {
      const resp: StatusResponse = {
        status: "ok",
        extension: EXTENSION_ID,
        sessions: storage.getIndex().length,
      };
      sendJson(200, resp);
      return;
    }

    // POST endpoints
    if (req.method === "POST") {
      let body = "";
      let tooLarge = false;

      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
        if (body.length > MAX_BODY) {
          tooLarge = true;
          req.destroy();
        }
      });

      req.on("end", async () => {
        if (tooLarge) {
          sendJson(413, { error: "Payload too large" });
          return;
        }

        try {
          if (req.url === "/notify") {
            const notification: EditNotification = JSON.parse(body);

            // Validate required fields
            if (
              !notification.id ||
              !notification.changes ||
              !Array.isArray(notification.changes) ||
              notification.changes.length === 0
            ) {
              sendJson(400, { error: "Invalid notification: missing id or changes" });
              return;
            }

            const meta = await storage.saveSession(notification);
            if (!meta) {
              const resp: NotifyResponse = {
                received: true,
                stored: false,
                reason: "no matching workspace folder for any changed file",
              };
              sendJson(200, resp);
              return;
            }

            // Refresh UI on the main thread
            treeProvider.refresh();
            updateBadge();

            const resp: NotifyResponse = {
              received: true,
              stored: true,
              id: meta.id,
              files: meta.files.length,
            };
            sendJson(200, resp);
            return;
          }

          if (req.url === "/clear") {
            const req_body = body ? JSON.parse(body) : {};
            const cleared = await storage.clearAll(req_body.workspacePath);
            treeProvider.refresh();
            updateBadge();
            const resp: ClearResponse = { cleared };
            sendJson(200, resp);
            return;
          }

          sendJson(404, { error: "Not found" });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(500, { error: msg });
        }
      });

      req.on("error", () => {
        sendJson(500, { error: "Request error" });
      });

      return;
    }

    sendJson(404, { error: "Not found" });
  });

  server.on("error", (err) => {
    vscode.window.showErrorMessage(
      `OpenCode Diff Viewer: HTTP server error: ${err.message}`
    );
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[opencode-diff-viewer] HTTP server listening on 127.0.0.1:${port}`);
  });

  context.subscriptions.push({
    dispose: () => {
      server?.close();
      server = undefined;
    },
  });

  // ─── React to config changes ───
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("opencode-diff-viewer.autoExpandLatest")) {
        const newVal = vscode.workspace
          .getConfiguration("opencode-diff-viewer")
          .get<boolean>("autoExpandLatest", true);
        treeProvider.setAutoExpandLatest(newVal);
        treeProvider.refresh();
      }
      if (e.affectsConfiguration("opencode-diff-viewer.port")) {
        vscode.window.showInformationMessage(
          "OpenCode Diff Viewer: port change requires a reload."
        );
      }
    })
  );
}

export function deactivate(): void {
  server?.close();
  server = undefined;
}
