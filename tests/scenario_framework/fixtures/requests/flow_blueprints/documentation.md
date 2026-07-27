---
trace_id: "documentation-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "documentation"
---

# Write the operator guide for the scenario evaluation framework

Write the operator-facing guide for running scenario evaluations, drawing on `tests/scenario_framework/runner/main.ts` and its flags. Cover:

- Selecting scenarios by pack, tag and profile, and how the selectors differ
- Reading a run manifest and the suite score
- The sandbox: where it is created, what it contains, and when it is reused
- Debugging a failing scenario, including the fast-fail and timeout flags

Acceptance criteria:

- Every documented flag exists in the runner and is spelled correctly
- The selector differences are stated, not implied
- A reader can run one scenario and interpret its output without reading source
