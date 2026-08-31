---
trace_id: "tools-relationship-query-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
---

# Test query_relationships/who_depends_on Solo tools

Required by the scenario schema; not submitted by any step. This scenario calls the
Solo-tier `query_relationships`/`who_depends_on` `ToolRegistry` tools directly via
`call_tool_registry_tool.ts`, not through a request→plan flow.
