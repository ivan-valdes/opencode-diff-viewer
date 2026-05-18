#!/usr/bin/env bash
set -euo pipefail

# opencode-diff-viewer installer
# Installs the OpenCode plugin and the VS Code extension

VERSION="0.1.0-beta"
REPO="ivan-valdes/opencode-diff-viewer"
RELEASE_TAG="v${VERSION}"

PLUGIN_NAME="opencode-diff-viewer.ts"
VSIX_NAME="opencode-diff-viewer-0.1.0.vsix"

PLUGIN_DIR="${HOME}/.config/opencode/plugins"
OPENCODE_JSON="${HOME}/.config/opencode/opencode.json"

echo "=== opencode-diff-viewer installer (${VERSION}) ==="
echo ""

# --- Detect script directory or download from GitHub ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/${PLUGIN_NAME}" && -f "${SCRIPT_DIR}/${VSIX_NAME}" ]]; then
    echo "[*] Found local files in ${SCRIPT_DIR}"
    PLUGIN_SRC="${SCRIPT_DIR}/${PLUGIN_NAME}"
    VSIX_SRC="${SCRIPT_DIR}/${VSIX_NAME}"
else
    echo "[*] Downloading assets from GitHub release ${RELEASE_TAG}..."
    TMPDIR=$(mktemp -d)
    trap 'rm -rf "${TMPDIR}"' EXIT

    BASE_URL="https://github.com/${REPO}/releases/download/${RELEASE_TAG}"

    curl -fSL "${BASE_URL}/${PLUGIN_NAME}" -o "${TMPDIR}/${PLUGIN_NAME}"
    curl -fSL "${BASE_URL}/${VSIX_NAME}" -o "${TMPDIR}/${VSIX_NAME}"

    PLUGIN_SRC="${TMPDIR}/${PLUGIN_NAME}"
    VSIX_SRC="${TMPDIR}/${VSIX_NAME}"
    echo "[OK] Downloaded"
fi

# --- Install OpenCode Plugin ---
echo ""
echo "[1/2] Installing OpenCode plugin..."
mkdir -p "${PLUGIN_DIR}"
cp "${PLUGIN_SRC}" "${PLUGIN_DIR}/${PLUGIN_NAME}"
echo "      Copied to ${PLUGIN_DIR}/${PLUGIN_NAME}"

# Add plugin to opencode.json if not already present
if [[ -f "${OPENCODE_JSON}" ]]; then
    if ! grep -q "opencode-diff-viewer" "${OPENCODE_JSON}" 2>/dev/null; then
        echo "      [!] Add this to your opencode.json 'plugin' array:"
        echo "          \"~/.config/opencode/plugins/${PLUGIN_NAME}\""
    else
        echo "      Already referenced in opencode.json"
    fi
else
    echo "      [!] No opencode.json found. Add this to your config:"
    echo "          { \"plugin\": [\"~/.config/opencode/plugins/${PLUGIN_NAME}\"] }"
fi

# --- Install VS Code Extension ---
echo ""
echo "[2/2] Installing VS Code extension..."
if command -v code &>/dev/null; then
    code --install-extension "${VSIX_SRC}" --force
    echo "      Extension installed successfully"
else
    echo "      [!] 'code' command not found. Install manually:"
    echo "          code --install-extension ${VSIX_SRC}"
fi

echo ""
echo "=== Installation complete ==="
echo "Restart VS Code and OpenCode to activate."
