---
trace_id: "full-refactor-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "high"
source: "cli"
created_by: "scenario-framework"
---

# Full Refactoring Workflow

Complete a full refactoring workflow combining dynamic exploration and targeted patches.

**Workflow:**

1. Explore the codebase to understand structure (dynamic mode)
2. Identify functions that need renaming
3. Apply patches to refactor function names
4. Verify changes were applied correctly

**Requirements:**

- Use dynamic execution for exploration phase
- Use declared execution for patch phase
- All tool calls must be logged to Activity Journal
- Final output should include summary of changes made

This end-to-end scenario tests the integration of dynamic tool selection with MCP tool handlers.
