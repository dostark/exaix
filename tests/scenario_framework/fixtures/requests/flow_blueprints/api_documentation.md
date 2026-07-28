---
trace_id: "api_documentation-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "api-documentation"
---

# Document the MCP tool surface for an external integrator

Produce reference documentation for the MCP tools exposed by `packages/mcp/server/tool_handler.ts`, written for someone integrating without access to this repository. Cover:

- Every tool's name, parameters and return shape
- Which tools mutate state and which are read-only
- The permission model: how an identity's `permitted_tools` restricts availability
- Error responses and which are retryable

Acceptance criteria:

- Every tool in the manifest is documented with parameters and returns
- Read-only and mutating tools are distinguished explicitly
- Each error case states whether a caller should retry
