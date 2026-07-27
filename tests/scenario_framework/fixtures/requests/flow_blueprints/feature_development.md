---
trace_id: "feature_development-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
flow: "feature-development"
---

# Add request-level cancellation to the execution pipeline

Design and specify cancellation for an in-flight request, touching `packages/execution/src/agent_orchestrator.ts` and the lease mechanism. Cover:

- How a cancellation is signalled and where it is observed
- What happens to a partially written plan or worktree
- Which operations are safe to interrupt and which must complete
- How cancellation is reported in the journal

Acceptance criteria:

- The signalling mechanism is specified end to end, not sketched
- Every partially-mutated artefact has a stated disposition
- Uninterruptible operations are listed with the reason
