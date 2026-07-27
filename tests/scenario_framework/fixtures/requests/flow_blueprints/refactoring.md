---
trace_id: "refactoring-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "refactoring"
---

# Extract the retry policy from the agent runner

Refactor retry handling out of `packages/execution/src/agent_runner.ts` into a policy the caller supplies, without changing behaviour. Cover:

- The current retry decision points and what each observes
- The interface the extracted policy needs
- Which existing tests pin the current behaviour and must stay green
- Call sites that need updating

Acceptance criteria:

- Behaviour is unchanged, demonstrated by the existing tests passing untouched
- The new interface is justified by two callers, not one
- Every call site is updated in the same change
