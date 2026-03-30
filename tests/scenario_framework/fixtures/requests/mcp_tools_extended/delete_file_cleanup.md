---
trace_id: "delete-file-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
---

# Delete Deprecated File

Please delete the deprecated file from the sample codebase.

**Requirements:**

1. Use the `delete_file` tool to remove the file
2. Verify the file no longer exists
3. Ensure no errors occur during deletion

**Target File:** `/tmp/sample-project/src/deprecated.ts`

This task tests the `delete_file` MCP tool handler's ability to safely remove files.
