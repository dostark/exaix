---
agent: senior-coder
scope: dev
title: "Phase 63: Flow-Level Error Recovery & Checkpointing (W13 Remediation)"
short_summary: Add onError step handling, flow checkpointing, and compensating transactions to FlowRunner so multi-step flows survive partial failures without losing completed work.
version: 1.2
topics:
  - flow-orchestration
  - error-recovery
  - checkpointing
  - flow-integrity
  - cost-aware-recovery
  - resilience
  - W13
---

## Phase 63: Flow-Level Error Recovery & Checkpointing

## Status: ✅ Implemented and Validated

**Author**: Comet Assistant (via senior-coder Blueprint)
**Date**: 2026-04-02
**Last Updated**: 2026-04-07
**Impact Level**: H (Core Flow Reliability)
**Risk Level**: M (Modifies FlowRunner step execution loop)
**Phase Dependencies**: Phase 57, Phase 59, Phase 62
**Blocking Phases**: None

## Executive Summary

Exaix currently has **no structured error recovery at the flow level** (**W13**). When an agent step inside a multi-step flow fails, `FlowRunner` propagates the error upward, abandons all completed work, and leaves any partially-modified worktree in an inconsistent state. There is no `onError` handling, no checkpointing of successfully completed steps, and no compensating-transaction mechanism to undo side-effects from steps that ran before the failing one.

This phase introduces three complementary capabilities to `FlowRunner`:

1. **Step-level `onError` declarations** — YAML-configurable fallback, retry, and compensate actions per step.

1.

### **Design Principles**

- **Idempotency First** — Each step's output is hashed; re-executing a previously completed step is detected and skipped automatically.
- **Fail-Fast with Grace** — Steps fail fast, but the flow manager decides how to recover rather than propagating a naked exception.
- **Worktree Safety** — Compensating transactions always run against the isolated worktree so the main branch is never touched.
- **Audit Trail** — Every recovery action (retry attempt, fallback selection, compensation run) is written to the Activity Journal with its own `trace_id` subspan.

---

## Current vs. Target Flow Failure Lifecycle

### **Current (W13 — No Recovery)**

```text
FlowRunner.run(steps)
├── Step 1 (analyze) — ✅ success
├── Step 2 (implement) — ✅ success  (files written to worktree)
├── Step 3 (test) — ❌ fail
└── Error propagates → entire flow aborted, step 2 changes stranded
```

### **Target (Phase 63)**

```text
FlowRunner.run(steps)
├── Step 1 (analyze)   — ✅ → checkpoint saved
├── Step 2 (implement) — ✅ → checkpoint saved
├── Step 3 (test)      — ❌ fail
│   ├── onError.action = retry (maxRetries: 2) → retry 1 → ❌
│   │                                         → retry 2 → ❌
│   └── onError.action = compensate → undo step 2 git changes
└── Flow terminates cleanly; journal records full recovery trace
```

---

## Weakness Remediation Mapping Matrix {#matrix}

| #       | Weakness                                                       | Solo 🟢     | Team 🔵     | Enterprise 🟣 | Fix Delivery Tier        | Notes                                                                                       |
| :------ | :------------------------------------------------------------- | :---------- | :---------- | :------------ | :----------------------- | :------------------------------------------------------------------------------------------ |
| **W13** | No flow-level error recovery, fallback steps, or checkpointing | ❌ Affected | ❌ Affected | ❌ Affected   | 🟢 All (Core FlowRunner) | Multi-step flows exist in all editions. `onError` + checkpointing is a core engine concern. |

---

## Implementation Plan

### Step 63.1: Schema — `IFlowStepError` and `IFlowCheckpoint`

- **Action**: Extend the flow YAML schema and runtime types.
- **Justification**: A concrete schema prevents ad-hoc string matching and makes the contract testable.

**New schema additions** (`src/shared/schemas/flow_schema.ts`):

```typescript
export const ZFlowStepOnError = z.object({
  action: z.enum(["retry", "fallback", "compensate", "abort"]),
  fallbackStep: z.string().optional(),
  maxRetries: z.number().int().min(1).max(5).optional().default(1),
  compensate: z.array(ZToolCall).optional(), // ordered rollback tool-calls
});

export const ZFlowCheckpoint = z.object({
  traceId: z.string(),
  flowContentHash: z.string().describe("Hash of the flow YAML to prevent resume on stale definitions"),
  completedSteps: z.record(z.string(), ZFlowStepResult), // keyed by step id
  savedAt: z.string().datetime(),
});
```

**Success Criteria:**

- [x] `ZFlowStepOnError` parses all four action variants without error.
- [x] Existing flow YAML files without `onError` continue to parse (field is optional).
- [x] `ZFlowCheckpoint` round-trips cleanly through JSON serialisation.

**Planned Tests:**

- ✅ **Unit**: `tests/flows/flow_step_on_error_schema_test.ts`

**✅ IMPLEMENTED** — `src/shared/schemas/flow.ts` (+ `src/shared/enums.ts`), 3/3 tests passing

---

### Step 63.2: `FlowRunner` — Retry & Fallback Loop

- **Action**: Wrap each step's execution in a recovery-aware harness.
- **Justification**: Retry and fallback are the most common recovery patterns and require no extra infrastructure.

**Logic** (inside `flow_runner.ts → executeStep()`):

```text
for attempt in 1..onError.maxRetries:
  // Phase 62 Integration: Check if retry exceeds cumulative cost budget
  if (currentFlowCost() > maxFlowBudget) throw BudgetExceededError()

  result = await runStep(step)
  if result.ok: break

if !result.ok && onError.action == "fallback":
  step = resolveStep(flow, onError.fallbackStep)
  result = await runStep(step)

if !result.ok && onError.action == "abort":
  throw FlowAbortError(step.id, result.error)
```

**Success Criteria:**

- [x] A step configured with `maxRetries: 2` is executed up to 3 times total before escalating.
- [x] A `fallback` step is resolved by `id` from the same flow definition.
- [x] Each retry/fallback attempt emits a `flow.step.retry` or `flow.step.fallback` journal event.
- [x] `abort` propagates a typed `FlowAbortError` with the originating step id.

**Planned Tests:**

- ✅ **Unit**: `tests/flows/flow_runner_test.ts` — retry, fallback, and abort recovery coverage added to the existing FlowRunner suite.

**✅ IMPLEMENTED** — `src/flows/flow_runner.ts`, `tests/flows/flow_runner_test.ts`; targeted retry/fallback/abort coverage verifies per-attempt journal payloads for retry and fallback recovery.

---

### Step 63.3: Flow Checkpointing

- **Action**: Persist completed step results to disk after each successful step; load checkpoint on flow restart.
- **Justification**: Without checkpointing, any restart of a long flow (e.g., 10 steps) wastes all prior LLM calls and worktree work.

**Checkpoint path**: `Memory/Execution/{traceId}/checkpoint.json`

**Write** (after each successful step):

```typescript
await checkpointService.save(traceId, completedStepResults);
```

**Load** (at flow start):

```typescript
const checkpoint = await checkpointService.load(traceId);
// Step 63.0: Validate integrity
if (checkpoint.flowContentHash !== currentFlowHash(flow)) {
  logger.warn("Flow definition changed; invalidating checkpoint.");
  return runAllSteps(steps);
}
const pendingSteps = steps.filter((s) => !checkpoint.completedSteps[s.id]);
```

**Success Criteria:**

- [x] `CheckpointService.save()` writes valid JSON to the correct path.
- [x] A re-started flow with an existing checkpoint skips already-completed steps.
- [x] Checkpoint file is deleted on clean flow completion (no leftover state).
- [x] `flow.checkpoint.saved` and `flow.checkpoint.loaded` events appear in the Activity Journal.

**Planned Tests:**

- ✅ **Integration**: `tests/integration/services/flow_checkpoint_test.ts` — simulate mid-flow crash; verify resume skips completed steps.

**✅ IMPLEMENTED** — `src/services/flow/flow_checkpoint_service.ts`, `src/flows/flow_runner.ts`, `tests/integration/services/flow_checkpoint_test.ts`; targeted integration coverage now also benchmarks checkpoint resume overhead and asserts restored-step journal payloads.

---

### Step 63.4: Compensating Transactions

- **Action**: Execute ordered rollback tool-calls against the isolated worktree when `action: compensate` is triggered.
- **Justification**: File-system changes made by earlier steps must be undone when a downstream step fails unrecoverably, otherwise the worktree is in an inconsistent state.

**Compensation execution order**: reverse of step completion order (last-in, first-out).

**Example YAML**:

```yaml
steps:
  - id: implement
    type: agent
    agent: senior-coder
    onError:
      action: compensate
      compensate:
        - tool: git_reset
          args: { mode: "hard", ref: "HEAD" }
        - tool: delete_directory
          args: { path: "src/generated/" }
```

**Success Criteria:**

- [x] Compensation tool-calls are invoked in LIFO order relative to completed steps.
- [x] Each compensation call is executed against the step's worktree, not `main`.
- [x] A `flow.step.compensated` journal event is emitted per compensation action.
- [x] If a compensation tool-call itself fails, the failure is logged but does not block remaining compensations.

**Planned Tests:**

- ✅ **Integration**: `tests/integration/services/flow_compensation_test.ts` — LIFO compensation order, portal/worktree-targeted tool args, per-action events, and failure-continue behavior.
- ✅ **Functional**: `tests/integration/37_multi_step_recovery_test.ts` — end-to-end: step 3 fails → steps 1 & 2 compensated → worktree clean.

**✅ IMPLEMENTED** — `src/flows/flow_runner.ts`, `src/services/request/request_router.ts`, `tests/integration/services/flow_compensation_test.ts`, `tests/integration/37_multi_step_recovery_test.ts`; targeted compensation integration, real worktree validation, routing, and FlowRunner/checkpoint regression suites passing, including explicit worktree-clean and successful-compensation assertions.

---

## Risks & Mitigations

| Risk                                               | Impact | Likelihood | Mitigation                                                                                        |
| :------------------------------------------------- | :----- | :--------- | :------------------------------------------------------------------------------------------------ |
| **R1: Compensation tool-call fails**               | Medium | Low        | Log and continue; emit `flow.compensation.partial_failure` event.                                 |
| **R2: Checkpoint grows stale across code changes** | Medium | Low        | Include a `schemaVersion` field in `ZFlowCheckpoint`; reject checkpoints with mismatched version. |
| **R3: Retry storms on transient LLM errors**       | High   | Medium     | Cap `maxRetries` at 5 in schema; apply exponential backoff (1s, 2s, 4s) between attempts.         |
| **R4: Fallback step creates infinite loop**        | Medium | Low        | Detect and reject cyclic fallback chains at flow load time.                                       |

---

## Success Metrics

- [x] **0 stranded worktrees** — Proven by `tests/integration/37_multi_step_recovery_test.ts`: compensated files are removed, compensation succeeds, and the git worktree is clean after downstream failure.
- [x] **100% retry visibility** — Proven by `tests/flows/flow_runner_test.ts`: retry attempts emit one `flow.step.retry` event per failed attempt with attempt/error payloads, and fallback emits the expected `flow.step.fallback` journal event.
- [x] **Checkpoint resume** — Proven by `tests/integration/services/flow_checkpoint_test.ts`: resumed execution restores the checkpoint, skips completed steps, and completes with measured resume overhead under 2 seconds.

---

**Agent Instructions**: Follow the implementation steps in sequence. Do not proceed to the next step until all "Planned Tests" for the current step pass with `deno task test`. For Step 63.4, run the functional test against a real worktree (use the `--worktree-mode` test flag) to validate git state.
