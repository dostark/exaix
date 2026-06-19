#!/bin/bash
# Build the mock session tool into a standalone binary for E2E scenarios.
# Phase 111 Step 9: The binary goes to .cache/ (gitignored) and is added to
# bin_overrides so HeadlessSessionLauncher can invoke it.
# Workaround: deno compile -o ignores the directory component in 2.x,
# so we compile in CWD then move the result.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT="${1:-$REPO_ROOT/.cache/mock_session_tool_bin}"

mkdir -p "$(dirname "$OUTPUT")"
deno compile -A "$SCRIPT_DIR/mock_session_tool.ts"
mv "$REPO_ROOT/mock_session_tool" "$OUTPUT"
echo "✅ Mock session tool compiled to: $OUTPUT"
