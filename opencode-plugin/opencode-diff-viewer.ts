/**
 * opencode-diff-viewer plugin for OpenCode
 *
 * Automatically tracks code changes across prompts and sends them to the
 * companion VS Code extension for visualization and revert support.
 *
 * Installation:
 *   cp opencode-diff-viewer.ts ~/.config/opencode/plugins/
 *
 * The VS Code extension must be running and listening on 127.0.0.1:19877.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "fs"
import { resolve } from "path"

const PORT = 19877
const HOST = "127.0.0.1"
const TIMEOUT_MS = 3000

// Tools that modify files
const EDIT_TOOLS = new Set([
  "edit",
  "write",
  "patch",
  "multiedit",
  "apply_patch",
  "applypatch",
])

const isEditTool = (name: string) => EDIT_TOOLS.has(name.toLowerCase())

/**
 * Extract file paths from tool arguments (same heuristic as git-ai).
 */
function extractFilePaths(args: unknown): string[] {
  const paths = new Set<string>()

  const walk = (val: unknown) => {
    if (typeof val === "string") {
      // Detect apply_patch markers
      for (const prefix of [
        "*** Update File: ",
        "*** Add File: ",
        "*** Delete File: ",
        "*** Move to: ",
      ]) {
        if (val.includes(prefix)) {
          for (const line of val.split("\n")) {
            const trimmed = line.trim()
            for (const pfx of [
              "*** Update File: ",
              "*** Add File: ",
              "*** Delete File: ",
              "*** Move to: ",
            ]) {
              if (trimmed.startsWith(pfx)) {
                const p = trimmed.slice(pfx.length).trim().replace(/^['"]|['"]$/g, "")
                if (p) paths.add(p)
              }
            }
          }
        }
      }
      return
    }
    if (Array.isArray(val)) {
      for (const item of val) walk(item)
      return
    }
    if (val && typeof val === "object") {
      for (const [key, v] of Object.entries(val)) {
        const k = key.toLowerCase()
        if (
          (k === "filepath" || k === "file_path" || k === "path" || k === "fspath") &&
          typeof v === "string"
        ) {
          paths.add(v)
        }
        walk(v)
      }
    }
  }

  walk(args)
  return [...paths]
}

function readFileSafe(filePath: string): string | undefined {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, "utf-8")
    }
  } catch {
    // ignore
  }
  return undefined
}

function resolvePath(filePath: string, cwd: string): string {
  const cleaned = filePath.trim().replace(/^['"]|['"]$/g, "")
  if (cleaned.startsWith("/")) return cleaned
  return resolve(cwd, cleaned)
}

function truncatePrompt(prompt: string, max = 80): string {
  if (prompt.length <= max) return prompt
  const cut = prompt.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut) + "..."
}

async function httpRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown } | null> {
  try {
    const url = `http://${HOST}:${PORT}${path}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const options: RequestInit = {
      method,
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
    }
    if (body) {
      options.body = JSON.stringify(body)
    }

    const resp = await fetch(url, options)
    clearTimeout(timer)

    const data = await resp.json()
    return { status: resp.status, data }
  } catch {
    return null // extension not running, fail silently
  }
}

interface FileSnapshot {
  filePath: string
  before: string | undefined
  existed: boolean
}

export const OpenCodeDiffViewerPlugin: Plugin = async (ctx) => {
  const workspacePath = ctx.directory

  // Per-session state
  const promptMap = new Map<string, string>() // sessionId → prompt
  const snapshotsMap = new Map<string, Map<string, FileSnapshot>>() // sessionId → (filePath → snapshot)
  const editedFilesMap = new Map<string, Set<string>>() // sessionId → set of edited file paths

  const ensureSessionMaps = (sessionId: string) => {
    if (!snapshotsMap.has(sessionId)) {
      snapshotsMap.set(sessionId, new Map())
    }
    if (!editedFilesMap.has(sessionId)) {
      editedFilesMap.set(sessionId, new Set())
    }
  }

  return {
    // Capture the user prompt
    "chat.message": async (input, output) => {
      const sessionId = input.sessionID
      // Extract text from message parts
      let promptText = ""
      if (output.parts) {
        for (const part of output.parts) {
          if ("content" in part && typeof (part as any).content === "string") {
            promptText += (part as any).content
          } else if ("text" in part && typeof (part as any).text === "string") {
            promptText += (part as any).text
          }
        }
      }
      if (!promptText && output.message) {
        // Fallback: try to get content from UserMessage
        const msg = output.message as any
        if (typeof msg.content === "string") {
          promptText = msg.content
        } else if (Array.isArray(msg.parts)) {
          for (const p of msg.parts) {
            if (typeof p === "string") promptText += p
            else if (p?.text) promptText += p.text
            else if (p?.content) promptText += p.content
          }
        }
      }
      if (promptText) {
        promptMap.set(sessionId, promptText.trim())
      }
      // Reset file tracking for new prompt
      snapshotsMap.set(sessionId, new Map())
      editedFilesMap.set(sessionId, new Set())
    },

    // Snapshot files BEFORE edit tools modify them
    "tool.execute.before": async (input, output) => {
      if (!isEditTool(input.tool)) return

      const sessionId = input.sessionID
      ensureSessionMaps(sessionId)

      const filePaths = extractFilePaths(output.args)
      const snapshots = snapshotsMap.get(sessionId)!

      for (const rawPath of filePaths) {
        const absPath = resolvePath(rawPath, workspacePath)
        if (!snapshots.has(absPath)) {
          // Only snapshot if we haven't already for this session
          const content = readFileSafe(absPath)
          snapshots.set(absPath, {
            filePath: absPath,
            before: content,
            existed: content !== undefined,
          })
        }
      }
    },

    // Track which files were edited
    "tool.execute.after": async (input) => {
      if (!isEditTool(input.tool)) return

      const sessionId = input.sessionID
      ensureSessionMaps(sessionId)

      const filePaths = extractFilePaths(input.args)
      const edited = editedFilesMap.get(sessionId)!

      for (const rawPath of filePaths) {
        const absPath = resolvePath(rawPath, workspacePath)
        edited.add(absPath)
      }
    },

    // On session idle, send accumulated changes to VSCode
    event: async ({ event }) => {
      if (event.type !== "session.idle") return

      const sessionId = (event as any).properties?.sessionID as string
      if (!sessionId) return

      const edited = editedFilesMap.get(sessionId)
      if (!edited || edited.size === 0) {
        // No files edited in this session, clean up
        cleanupSession(sessionId)
        return
      }

      const prompt = promptMap.get(sessionId) ?? "(no prompt captured)"
      const snapshots = snapshotsMap.get(sessionId) ?? new Map()

      // Build changes array
      const changes: Array<{
        filePath: string
        status: "added" | "modified" | "deleted"
        additions: number
        deletions: number
        before?: string
        after?: string
      }> = []

      for (const absPath of edited) {
        const snapshot = snapshots.get(absPath)
        const before = snapshot?.before
        const beforeExisted = snapshot?.existed ?? false
        const after = readFileSafe(absPath)
        const afterExists = after !== undefined

        // Determine status
        let status: "added" | "modified" | "deleted"
        if (!beforeExisted && afterExists) {
          status = "added"
        } else if (beforeExisted && !afterExists) {
          status = "deleted"
        } else {
          status = "modified"
        }

        // Skip if content is identical
        if (before === after) continue

        // Count additions/deletions (simple line-based)
        const beforeLines = (before ?? "").split("\n")
        const afterLines = (after ?? "").split("\n")
        const additions = Math.max(0, afterLines.length - beforeLines.length)
        const deletions = Math.max(0, beforeLines.length - afterLines.length)

        changes.push({
          filePath: absPath,
          status,
          additions: status === "added" ? afterLines.length : additions,
          deletions: status === "deleted" ? beforeLines.length : deletions,
          before,
          after,
        })
      }

      if (changes.length === 0) {
        cleanupSession(sessionId)
        return
      }

      // Generate unique ID
      const id = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

      const notification = {
        id,
        prompt,
        promptSummary: truncatePrompt(prompt),
        timestamp: Date.now(),
        workspacePath,
        sessionId,
        changes,
      }

      // Send to VSCode (fire and forget)
      await httpRequest("POST", "/notify", notification)

      cleanupSession(sessionId)
    },
  }

  function cleanupSession(sessionId: string) {
    promptMap.delete(sessionId)
    snapshotsMap.delete(sessionId)
    editedFilesMap.delete(sessionId)
  }
}
