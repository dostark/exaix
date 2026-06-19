#!/bin/bash
# Build the mock session tool into a standalone binary for E2E scenarios
# Phase 111 Step 9: The binary is added to bin_overrides so HeadlessSessionLauncher can invoke it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT="${1:-$SCRIPT_DIR/mock_session_tool_bin}"

deno compile -A "$SCRIPT_DIR/mock_session_tool.ts" -o "$OUTPUT"
echo "✅ Mock session tool compiled to: $OUTPUT"
