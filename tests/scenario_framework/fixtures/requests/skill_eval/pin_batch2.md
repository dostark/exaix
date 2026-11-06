---
trace_id: "skill-batch-2-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
skills: [architecture-review, implementation-plan, collaborative-flow, documentation-driven, error-handling]
---

# Plan improvements to the request and execution boundary

Prepare a bounded implementation plan for improving the boundary between `packages/request` and `packages/execution`.
`RequestProcessor` constructs the parsed request and hands it to `AgentRunner`; the contract
between them is an interface, but several fields are populated by mutation after
construction. Examine:

- Which fields of the parsed request are set by mutation rather than at construction, and
  whether any consumer can observe a half-populated object
- Whether the error contract is explicit: what each side may throw, and which failures are
  expected to be swallowed and journalled instead
- Whether the documented architecture in `ARCHITECTURE.md` still matches the code

Acceptance criteria:

- The current contract is described in one paragraph, distinguishing intent from accident
- Every mutation-after-construction site is listed with the risk it creates
- Each planned change names the affected contract, documentation, dependency, production wiring, and verification
- The output is an executable plan in raw JSON inside the response contract, without implementing the changes
