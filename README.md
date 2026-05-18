# opencode-diff-viewer

> **Beta** - This project is under active development. Expect breaking changes and incomplete features.

Track and visualise every code change that [OpenCode](https://opencode.ai) makes, right inside VS Code.

## How it works

```
┌───────────────────────────┐    HTTP :19877     ┌────────────────────────────────┐
│   OpenCode Plugin         │ ────────────────▶  │   VS Code Extension            │
│                           │                    │                                │
│ 1. Captures user prompt   │   POST /notify     │ 1. Receives edit notification  │
│ 2. Collects file diffs    │                    │ 2. Matches files to workspace  │
│ 3. Sends on session idle  │                    │ 3. Shows in TreeView panel     │
│                           │                    │ 4. Opens native diff viewer    │
│                           │                    │ 5. Can revert any change       │
└───────────────────────────┘                    └────────────────────────────────┘
```

Every time OpenCode finishes processing a prompt that modifies files, the plugin
sends a notification to the VS Code extension. The extension checks whether any
of the changed files live inside an open workspace folder and, if so, records
the edit session with full before/after content for offline diffs.

## Components

| Directory | Description |
|-----------|-------------|
| `opencode-plugin/` | OpenCode plugin (`opencode-diff-viewer.ts`) |
| `vscode-extension/` | VS Code extension (TypeScript, compiled to `out/`) |

## Installation

### OpenCode Plugin

```bash
cp opencode-plugin/opencode-diff-viewer.ts ~/.config/opencode/plugins/
```

Then add the plugin to your `opencode.json` (if not auto-detected):

```jsonc
{
  "plugin": ["~/.config/opencode/plugins/opencode-diff-viewer.ts"]
}
```

### VS Code Extension

Build and install the VSIX:

```bash
cd vscode-extension
npm install
npm run compile
npx @vscode/vsce package
code --install-extension opencode-diff-viewer-*.vsix
```

## Configuration (VS Code)

| Setting | Default | Description |
|---------|---------|-------------|
| `opencode-diff-viewer.port` | `19877` | HTTP port for communication |
| `opencode-diff-viewer.maxSessionHistory` | `50` | Max edit sessions to keep |
| `opencode-diff-viewer.autoExpandLatest` | `true` | Auto-expand the latest session in the panel |

## Panel

The extension adds an **OpenCode Edits** panel in the Activity Bar. Each entry
shows the prompt that triggered the changes, the number of files affected, and
total additions/deletions. Click a file to open the diff viewer. Right-click
for revert options.

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Health check |
| `POST` | `/notify` | Receive an edit notification |
| `POST` | `/clear` | Clear session history |

## License

MIT
