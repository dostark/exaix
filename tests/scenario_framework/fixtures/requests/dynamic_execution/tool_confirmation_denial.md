---
trace_id: "tool-confirmation-denial-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
---

# Test Tool Confirmation Denial Lifecycle

This request supports the Phase 79 scenario that exercises the queued tool confirmation denial path.

Expected behavior:

1. A pending tool confirmation can be listed through `exactl tool pending`
2. The pending confirmation can be denied through `exactl tool deny`
3. The denied confirmation no longer appears in the pending list
