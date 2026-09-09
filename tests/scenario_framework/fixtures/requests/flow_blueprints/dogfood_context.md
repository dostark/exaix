---
trace_id: "dogfood-context-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
agent_role: "senior-coder"
---

# Document the billing-service payment retry backoff policy

Write a short internal note describing how the billing service retries a failed
payment charge, covering the backoff schedule and the maximum attempt count.

Acceptance criteria:

- The retry backoff schedule is stated explicitly
- The maximum attempt count is stated explicitly
