---
trace_id: "create-dir-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
---

# Create Directory Structure

Please create the required directory structure for the new module in the sample codebase.

**Requirements:**

1. Use the `create_directory` tool to create nested directories
2. Verify all directories were created successfully
3. Ensure the operation is idempotent (can be run multiple times)

**Target Path:** `/tmp/sample-project/src/modules/new-feature/components`

This task tests the `create_directory` MCP tool handler's ability to create nested directory structures.
