---
trace_id: "tools-relationship-query-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
---

# Test query_relationships/find_dependents Solo tools

Required by the scenario schema; not submitted by any step. This scenario calls the
Solo-tier `query_relationships`/`find_dependents` `ToolRegistry` tools directly via
`call_tool_registry_tool.ts`, not through a request→plan flow.
