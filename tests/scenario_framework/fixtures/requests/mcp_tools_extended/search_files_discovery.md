---
trace_id: "search-files-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
---

# Search for TypeScript Files

Please search for all TypeScript test files in the sample codebase.

**Requirements:**

1. Use the `search_files` tool with glob pattern
2. Return all matching files with their paths
3. Verify search results are portal-relative paths

**Search Pattern:** `**/*.test.ts`
**Search Path:** `/tmp/sample-project/src`

This task tests the `search_files` MCP tool handler's ability to perform glob-based file discovery.
