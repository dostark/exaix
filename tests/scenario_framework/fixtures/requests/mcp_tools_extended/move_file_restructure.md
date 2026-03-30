---
trace_id: "move-file-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
---

# Move File to New Location

Please move the utility file to the correct directory in the sample codebase.

**Requirements:**

1. Use the `move_file` tool to relocate the file
2. Verify the file exists at the new location
3. Ensure the old location no longer contains the file

**Source:** `/tmp/sample-project/src/utils.ts`
**Destination:** `/tmp/sample-project/src/helpers/utils.ts`

This task tests the `move_file` MCP tool handler's ability to rename and move files.
