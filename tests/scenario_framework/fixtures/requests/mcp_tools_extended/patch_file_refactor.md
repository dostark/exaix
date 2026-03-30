---
trace_id: "patch-file-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
---

# Refactor Function Name Using Patch File

Please refactor the function name in the sample codebase from `oldFunctionName` to `newFunctionName`.

**Requirements:**

1. Use the `patch_file` tool to make the change
2. Verify the patch was applied successfully
3. Ensure no other content was modified

**Target File:** `/tmp/sample-project/src/main.ts`

**Expected Change:**

- Search for: `export function oldFunctionName()`
- Replace with: `export function newFunctionName()`

This task tests the `patch_file` MCP tool handler's ability to make targeted edits.
