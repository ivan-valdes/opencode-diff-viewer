// ─── Wire format (OpenCode plugin → VSCode extension via HTTP) ───

export interface EditNotification {
  /** Unique ID for this edit (UUID) */
  id: string;
  /** Full user prompt that triggered the changes */
  prompt: string;
  /** Short summary (first ~80 chars, truncated at word boundary) */
  promptSummary: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Absolute path of the directory opencode is working from */
  workspacePath: string;
  /** OpenCode session ID */
  sessionId: string;
  /** Files changed in this edit */
  changes: FileChange[];
}

export interface FileChange {
  /** Absolute path to the file */
  filePath: string;
  /** Type of change */
  status: "added" | "modified" | "deleted";
  /** Lines added */
  additions: number;
  /** Lines removed */
  deletions: number;
  /** File content BEFORE the edit (undefined for 'added') */
  before?: string;
  /** File content AFTER the edit (undefined for 'deleted') */
  after?: string;
}

// ─── Internal storage types (VSCode extension) ───

/** Lightweight metadata stored in index.json for fast TreeView load */
export interface EditSessionMeta {
  id: string;
  prompt: string;
  promptSummary: string;
  timestamp: number;
  workspacePath: string;
  sessionId: string;
  /** Whether the session was reverted */
  reverted: boolean;
  /** Summary counts */
  totalAdditions: number;
  totalDeletions: number;
  /** File entries (without before/after content) */
  files: FileEntryMeta[];
}

export interface FileEntryMeta {
  filePath: string;
  relativePath: string;
  workspaceFolder: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
}

/** Full session data stored in {id}.json (includes before/after) */
export interface StoredEditSession extends EditSessionMeta {
  changes: StoredFileChange[];
}

export interface StoredFileChange {
  filePath: string;
  relativePath: string;
  workspaceFolder: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  before?: string;
  after?: string;
}

// ─── HTTP API types ───

export interface StatusResponse {
  status: "ok";
  extension: string;
  sessions: number;
}

export interface NotifyResponse {
  received: true;
  stored: boolean;
  id?: string;
  files?: number;
  reason?: string;
}

export interface ClearRequest {
  workspacePath?: string;
}

export interface ClearResponse {
  cleared: number;
}
