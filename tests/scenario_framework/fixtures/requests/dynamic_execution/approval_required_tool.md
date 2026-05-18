---
trace_id: "approval-required-tool-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
---

# Test Approval-Required Dynamic Tool Boundary

This request supports the Phase 79 scenario that validates approval-required domain tools are now accepted in dynamic flow definitions.

Expected behavior:

1. The flow definition remains valid when `exaix_create_request` appears in `permitted_tools`
2. The runtime still requires explicit confirmation before the tool executes
3. The scenario only validates the flow boundary, not the live approval workflow
