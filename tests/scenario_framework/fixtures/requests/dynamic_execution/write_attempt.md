---
trace_id: "write-attempt-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
---

# Test Write Tool in Dynamic Mode

This request is designed to test that dynamic mode properly rejects write tools.

**Important:** This is a test scenario. The flow configuration intentionally includes an invalid tool to verify security boundaries.

Expected behavior:

1. Flow validation should fail because `write_file` is not allowed in dynamic mode
2. Error message should clearly indicate that write tools are not permitted
3. No files should be modified

This test verifies the security boundary between dynamic (read-only) and declared (full access) execution modes.
