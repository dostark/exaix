---
agent: senior-coder
scope: dev
title: "Phase 63: Flow-Level Error Recovery & Checkpointing (W13 Remediation)"
short_summary: Add onError step handling, flow checkpointing, and compensating transactions to FlowRunner so multi-step flows survive partial failures without losing completed work.
version: 1.4
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

## Status: 🚧 Gap Remediation In Progress

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
- [ ] **Backoff on retry** — Proven by unit test in `tests/flows/flow_runner_test.ts`: DENO_TEST mode skips delay; production path uses exponential multiplier via `RetryPolicy`.
- [ ] **Stable LIFO for concurrent steps** — Proven by updated `tests/integration/services/flow_compensation_test.ts`: same-wave steps compensated in deterministic order with `setTimeout` workaround removed.

---

**Agent Instructions**: Follow the implementation steps in sequence. Do not proceed to the next step until all "Planned Tests" for the current step pass with `deno task test`. For Step 63.4, run the functional test against a real worktree (use the `--worktree-mode` test flag) to validate git state.

Searched for text `onError|compensat|retry|fallback|FlowAbort|handleStepFailure|BudgetExceeded` (`**/src/flows/flow_runner.ts`), 20 results

Searched for text `onError|compensat|retry|fallback|FlowAbort|checkpoint|recovery` (`**/src/shared/schemas/flow.ts`), 14 results

Read [](file:///home/dkasymov/git/exaix/src/flows/flow_runner.ts#1-1), lines 1 to 65

Read [](file:///home/dkasymov/git/exaix/src/flows/flow_runner.ts#820-820), lines 820 to 1050

Read [](file:///home/dkasymov/git/exaix/src/shared/schemas/flow.ts#30-30), lines 30 to 65

Searched for text `backoff|exponential|sleep|delay|BudgetExceeded|maxFlowBudget|cyclic|cycle` (`**/src/flows/flow_runner.ts`), no results

Searched for text `retry|fallback|abort|compensat|onError|backoff|cyclic|budget` (`**/tests/flows/flow_runner_test.ts`), 20 results

Read [](file:///home/dkasymov/git/exaix/src/flows/flow_runner.ts#80-80), lines 80 to 155

Searched for regex `onError|FlowStepOnErrorAction|RETRY|FALLBACK|ABORT|COMPENSATE` (`**/tests/flows/flow_runner_test.ts`), 20 results

Searched for text `cyclic|validateFallback|fallbackChain|loadCheckpointIfAvailable|schemaVersion` (`**/src/flows/flow_runner.ts`), 3 results

Read [](file:///home/dkasymov/git/exaix/src/flows/flow_runner.ts#1456-1456), lines 1456 to 1530

Read [](file:///home/dkasymov/git/exaix/tests/flows/flow_runner_test.ts#295-295), lines 295 to 430

Compacted conversation

Read [](file:///home/dkasymov/git/exaix/tests/flows/flow_runner_test.ts#430-430), lines 430 to 530

Read [](file:///home/dkasymov/git/exaix/src/flows/flow_runner.ts#1530-1530), lines 1530 to 1560

Searched for files matching `**/tests/integration/*flow*checkpoint*`, no matches

Read [](file:///home/dkasymov/git/exaix/src/flows/flow_runner.ts#1560-1560), lines 1560 to 1620

Searched for files matching `**/tests/integration/**/*`, 46 matches

Searched for regex `COMPENSATE|compensat|compensation|FlowStepOnErrorAction.ABORT|FlowStepOnErrorAction.FALLBACK` (`**/tests/flows/flow_runner_test.ts`), 2 results

Read [](file:///home/dkasymov/git/exaix/tests/integration/services/flow_checkpoint_test.ts#1-1), lines 1 to 120

Read [](file:///home/dkasymov/git/exaix/tests/integration/services/flow_compensation_test.ts#1-1), lines 1 to 120

Read [](file:///home/dkasymov/git/exaix/tests/integration/services/flow_compensation_test.ts#120-120), lines 120 to 203

Read [](file:///home/dkasymov/git/exaix/tests/integration/services/flow_checkpoint_test.ts#120-120), lines 120 to 164

Read [](file:///home/dkasymov/git/exaix/tests/integration/37_multi_step_recovery_test.ts)

Read [](file:///home/dkasymov/git/exaix/src/flows/flow_runner.ts#100-100), lines 100 to 835

Now let me read the Phase 63 plan document and relevant weakness doc entries for the full comparison.

Searched for text `W13|flow.*error|recovery|fallback|checkpoint|compensation` (`**/docs/dev/Exaix_Weaknesses.md`), 20 results

Read [](file:///home/dkasymov/git/exaix/.copilot/planning/phase-63-flow-error-recovery.md#1-1), lines 1 to 250

Read [](file:///home/dkasymov/git/exaix/.copilot/planning/phase-63-flow-error-recovery.md#250-250), lines 250 to 259

Read [](file:///home/dkasymov/git/exaix/src/flows/flow_runner.ts#270-270), lines 270 to 835

Now let me check the actual retry loop and the `handleStepFailureRecovery` full body, plus the `clearCheckpointOnSuccess` event name:

Searched for regex `handleStepFailureRecovery|RETRY|maxRetries|attempt.*retry|retry.*attempt` (`**/src/flows/flow_runner.ts`), 15 results

Read [](file:///home/dkasymov/git/exaix/src/flows/flow_runner.ts#1050-1050), lines 1050 to 1070

Read [](file:///home/dkasymov/git/exaix/src/flows/flow_runner.ts#824-824), lines 824 to 920

Let me check the compensation implementation for sort order details:

Searched for text `flow.checkpoint.deleted` (`**/src/flows/flow_runner.ts`), no results

Read [](file:///home/dkasymov/git/exaix/src/flows/flow_runner.ts#920-920), lines 920 to 1000

I now have a complete picture. Here is the comprehensive Phase 63 implementation review:

---

## Phase 63 — Deep Implementation Review

### Assessment: Core delivery ✅, 9 gaps found across 3 severity levels

---

### HIGH — Promise made, safety risk present

#### G1: No exponential backoff between retry attempts

- **Plan (R3):** "Apply exponential backoff (1s, 2s, 4s) between attempts."
- **Code:** `handleStepFailureRecovery` retry loop (lines 842–862) has zero delay. Hits next attempt immediately.
- **Schema:** `ZFlowStepOnError` has no `backoffMs` or `backoffStrategy` field. (The `retry.backoffMs` on `IFlowStep` is for the step-execution retry via `ZFlowStep`, **not** the `onError.action: RETRY` path — separate mechanism.)
- **R3 outcome:** Half-delivered. `maxRetries` cap of 5 ✅. Backoff ❌. The risk ("retry storms on transient LLM errors") is only half-mitigated.

#### G4: No Phase 62 cost-budget check in retry loop

- **Plan (Step 63.2 pseudocode):** `if (currentFlowCost() > maxFlowBudget) throw BudgetExceededError()`
- **Code:** No reference to `BudgetExceededError`, `currentFlowCost`, or `maxFlowBudget` anywhere in flow_runner.ts.
- **Impact:** Unlimited LLM spend on retry loops. The explicit "Phase 62 Integration" annotation in the pseudocode is a dead promise.

#### G8: Fallback step bypasses its own `onError` policy

- **Code:** `handleStepFailureRecovery` calls `runStepAttempt(flowRunId, fallbackStep, ...)` directly — which skips both condition evaluation and `handleStepFailureRecovery` for the fallback step.
- **Effect:** If the fallback step has `onError: { action: RETRY, maxRetries: 3 }`, those retries never fire. The fallback step gets exactly one attempt.
- **Not tested:** The only fallback test uses a `fallbackStep` with no `onError`, so this is invisible in the test suite.

---

### MEDIUM — Explicit plan promise unfulfilled

#### G3: `ZFlowCheckpoint` missing `schemaVersion`

- **Plan (R2):** "Include a `schemaVersion` field in `ZFlowCheckpoint`; reject checkpoints with mismatched version."
- **Schema (flow.ts):** `traceId`, `flowContentHash`, `completedSteps`, `savedAt` — no `schemaVersion`.
- **Partial mitigation:** `flowContentHash` catches YAML changes but not code-level schema mutations (e.g. renaming `completedAt` → `finishedAt` in `IFlowStepResult`). A silent corrupt resume is possible after a code upgrade that changes step result serialization.

#### G6: Compensation LIFO sort is wall-clock-only — unstable for same-wave steps

- **Code:** `executeCompensatingTransactions` sorts by `b.completedAt.getTime() - a.completedAt.getTime()`.
- **Problem:** Two parallel steps in the same wave resolving within the same millisecond produce ties — JavaScript's `Array.prototype.sort` is not stable across all engines for tied keys.
- **Workaround in test:** 37_multi_step_recovery_test.ts inserts `await new Promise(r => setTimeout(r, 5))` in the step2 handler to force distinct timestamps — this is a test artifact that conceals the production gap.
- **Fix:** Track wave-sequence and within-wave insertion index alongside `completedAt` as a tiebreaker.

---

### LOW — Minor promise gaps or test coverage holes

#### G2: No cyclic fallback chain detection

- **Plan (R4):** "Detect and reject cyclic fallback chains at flow load time."
- **Code:** `validateIFlow` only checks `steps.length > 0`.
- **Why not dangerous today:** The FALLBACK path calls `runStepAttempt` (not `executeStep`), so the fallback step's own `onError` is ignored — cycles cannot recurse. But the contract is broken; a future fix to G8 that makes fallback respect `onError` would immediately make cycles dangerous.

#### G5: `IStepResult` carries no recovery metadata

- **Design principle stated in plan:** "Audit Trail — Every recovery action is written to the Activity Journal."
- **Code:** Journal events exist. But `IStepResult` has no `wasRetried`, `retriesExhausted`, `fallbackUsed`, or `compensationRan` fields.
- **Impact:** Callers of `IFlowResult.stepResults` cannot tell whether a step succeeded on attempt 1 or after 3 retries and a fallback, without scraping the journal. Monitoring dashboards are blind to recovery cost.

#### G7: `flow.checkpoint.cleared` event not asserted in the checkpoint test

- **Code:** `clearCheckpointOnSuccess` emits `flow.checkpoint.cleared`.
- **Test (flow_checkpoint_test.ts):** Asserts `exists(checkpointPath) === false` (file deleted ✅) but never checks `events.find(e => e.event === "flow.checkpoint.cleared")`.
- **Also:** `loadCheckpointIfAvailable` emits `flow.checkpoint.stale` and deletes stale checkpoints — this code path has **no integration test at all**.

#### G9: Stale-hash checkpoint invalidation has no direct test

- **Code:** `loadCheckpointIfAvailable` detects `checkpoint.flowContentHash !== flowContentHash`, emits `flow.checkpoint.stale`, calls `checkpointService.delete()`, and returns without restoring.
- **Test coverage:** Zero. The only checkpoint test uses a matching hash.
- **Risk:** The stale-hash detection is the entire defense against replaying a checkpoint across an incompatible flow change. A logic bug here would be invisible.

---

### Summary Table

| ID | Gap | Severity | Plan Section | In Tests? |
| ---- | ----- | ---------- | ------------- | ----------- |
| G1 | No retry backoff | **High** | R3 | ❌ |
| G4 | No budget check in retry | **High** | Step 63.2 pseudocode | ❌ |
| G8 | Fallback ignores its own `onError` | **High** | Implicit from semantics | Hidden by test setup |
| G3 | `ZFlowCheckpoint` missing `schemaVersion` | **Medium** | R2 | ❌ |
| G6 | LIFO sort unstable for same-wave steps | **Medium** | Step 63.4 principles | Masked by `setTimeout` |
| G2 | No cyclic fallback detection | Low | R4 | ❌ |
| G5 | `IStepResult` no recovery metadata | Low | Design principle | ❌ |
| G7 | `cleared` event not asserted in test | Low | Step 63.3 | Partial |
| G9 | Stale-hash invalidation not tested | Low | Step 63.3 | ❌ |

---

### What was delivered correctly

- RETRY loop respects `maxRetries`, emits per-attempt journal events with correct payload ✅
- FALLBACK resolves step by ID from same flow, emits `flow.step.fallback` ✅
- ABORT throws typed `FlowAbortError` carrying `stepId` and `failureResult` ✅
- Checkpoint save/load/clear lifecycle is functionally correct ✅
- LIFO compensation order is correct for sequential flows; portal args injected correctly ✅
- Compensation failure is silently continued with `flow.step.compensation_failed` event ✅
- Stale-hash checkpoint detection logic is correct (just untested) ✅
- All three integration tests pass and verify real worktree/portal state ✅

---

## Gap Remediation Plan

The nine gaps above are addressed by Steps 63.6 – 63.14 below. Steps are ordered by severity (High → Medium → Low) and dependency (G2 must follow G8; G3 must precede G9 test). All steps follow the TDD-First policy.

---

### Step 63.6 (G1): Exponential Backoff on `RETRY` action

- **Action**: Add `backoffMs` (optional, default `1000`) to `ZFlowStepOnError`; implement a exponential `2^(attempt-1) * backoffMs` delay capped at 30 000 ms inside the retry loop in `handleStepFailureRecovery`.
- **Files**: `src/shared/schemas/flow.ts` (`ZFlowStepOnError`), `src/flows/flow_runner.ts` (`handleStepFailureRecovery`).
- **Architecture Notes**: Use the existing `RetryPolicy` service (`src/services/retry_policy.ts`) to calculate delay; call `await new Promise(r => setTimeout(r, delayMs))` between attempts. Guard with `if (Deno.env.get("DENO_TEST") !== "1")` to prevent timer leaks in tests.

**Success Criteria:**

- [ ] `ZFlowStepOnError` parses `backoffMs` as optional positive integer; defaults to `1000`.
- [ ] Retry attempts 1, 2, 3 produce delays of 1 s, 2 s, 4 s (or `backoffMs`, `2×`, `4×`) in production mode.
- [ ] No delay is introduced in `DENO_TEST=1` mode.
- [ ] R3 risk row updated to **Mitigated** in the Risks table above.

**Planned Tests:**

- [ ] **Unit**: `tests/flows/flow_runner_test.ts` — add `"FlowRunner: retry backoff is skipped in test mode"` test; assert zero `flow.step.retry` delay via wall-clock measurement under `DENO_TEST=1`.
- [ ] **Unit**: `tests/schemas/flow_schema_test.ts` (or `tests/flows/flow_step_on_error_schema_test.ts`) — assert `backoffMs` field parses correctly and defaults to `1000`.

---

### Step 63.7 (G4): Phase 62 Cost-Budget Guard in Retry Loop

- **Action**: Before each retry attempt in `handleStepFailureRecovery`, query cumulative flow cost from `db.queryActivity` (action type `"llm.usage"`, same `traceId`) and throw `FlowExecutionError` with message `"Retry budget exceeded"` if total cost exceeds `config.maxFlowRetryCostUsd` (new config field, default `0` = disabled).
- **Files**: `src/shared/schemas/flow.ts` (no change), `src/flows/flow_runner.ts` (retry loop), `src/config/service.ts` or `src/config/schema.ts` (new `maxFlowRetryCostUsd` field).
- **Architecture Notes**: Guard with `if (!this.db || !request.traceId || !config.maxFlowRetryCostUsd)` to keep retrocompatibility when DB or traceId is absent (e.g., unit tests that use no DB).

**Success Criteria:**

- [ ] When cumulative LLM cost exceeds `maxFlowRetryCostUsd`, the retry loop terminates with `FlowExecutionError("Retry budget exceeded")`.
- [ ] When `maxFlowRetryCostUsd` is `0` or absent, behavior is identical to current code.
- [ ] Step 63.2 pseudocode updated to reflect actual implementation (replace `BudgetExceededError` with `FlowExecutionError`).

**Planned Tests:**

- [ ] **Unit**: `tests/flows/flow_runner_test.ts` — `"FlowRunner: retry aborts when cost budget is exceeded"` — mock `db.queryActivity` to return a cost above threshold; assert `FlowExecutionError` is thrown before the second retry fires.

---

### Step 63.8 (G8): Fallback Step Respects Its Own `onError` Policy

- **Action**: Replace the direct `runStepAttempt(flowRunId, fallbackStep, ...)` call in `handleStepFailureRecovery` with `executeStep(flowRunId, fallbackStep.id, flow, request, stepResults)` so the fallback step goes through the full step harness (condition evaluation + recovery policy).
- **Files**: `src/flows/flow_runner.ts` (`handleStepFailureRecovery` FALLBACK branch).
- **Architecture Notes**: `executeStep` already handles condition skipping and calls `handleStepFailureRecovery` recursively. Cyclic protection (Step 63.9/G2) **must** be implemented before or alongside this step to prevent infinite recursion.

**Success Criteria:**

- [ ] A fallback step configured with `onError: { action: RETRY, maxRetries: 2 }` retries up to 2 times when it itself fails.
- [ ] A fallback step with no `onError` behaves identically to the current implementation.
- [ ] Cyclic fallback detection (G2) blocks A→B→A chains at flow load time before this code path can loop.

**Planned Tests:**

- [ ] **Unit**: `tests/flows/flow_runner_test.ts` — `"FlowRunner: fallback step retries according to its own onError policy"` — primary fails, fallback fails twice, then succeeds on retry 2; assert `flow.step.retry` events reference the fallback step id.

---

### Step 63.9 (G2): Cyclic Fallback Chain Detection at Flow Load Time

- **Action**: In `validateIFlow`, traverse the fallback graph (`step.onError?.fallbackStep → resolve → repeat`) and throw `FlowExecutionError("Cyclic fallback chain detected: A → B → A")` if any step is visited twice.
- **Files**: `src/flows/flow_runner.ts` (`validateIFlow`).
- **Architecture Notes**: Use a `Set<string>` visited tracker per traversal starting-step; O(n²) worst case is acceptable given `maxSteps` is bounded by the schema. Must complete before Step 63.8 lands.

**Success Criteria:**

- [ ] A flow with `A.fallbackStep = "B", B.fallbackStep = "A"` fails at validation with a descriptive error naming both step ids.
- [ ] A linear fallback chain `A → B → C` (no cycle) loads without error.
- [ ] `flow.validation.failed` journal event is emitted with `error` payload naming the cycle.

**Planned Tests:**

- [ ] **Unit**: `tests/flows/flow_runner_test.ts` — `"FlowRunner: rejects flow with cyclic fallback chain at validation"` — assert `FlowExecutionError` thrown with cycle-describing message.
- [ ] **Unit**: `tests/flows/flow_runner_test.ts` — `"FlowRunner: accepts linear fallback chain A→B→C"` — assert flow loads and executes without validation error.

---

### Step 63.10 (G3): Add `schemaVersion` to `ZFlowCheckpoint`

- **Action**: Add `schemaVersion: z.string().default("1")` to `ZFlowCheckpoint` and `IFlowCheckpoint`. In `loadCheckpointIfAvailable`, reject (emit `flow.checkpoint.stale`, delete) any checkpoint whose `schemaVersion` does not equal the current constant `FLOW_CHECKPOINT_SCHEMA_VERSION = "1"`. Increment the constant to `"2"` on any future structural change to `IFlowStepResultSnapshot`.
- **Files**: `src/shared/schemas/flow.ts`, `src/flows/flow_runner.ts`, `src/constants.ts` (new `FLOW_CHECKPOINT_SCHEMA_VERSION` constant).

**Success Criteria:**

- [ ] `ZFlowCheckpoint.parse({...})` without `schemaVersion` sets it to `"1"` (default).
- [ ] `loadCheckpointIfAvailable` emits `flow.checkpoint.stale` and discards a checkpoint with `schemaVersion: "0"`.
- [ ] `FLOW_CHECKPOINT_SCHEMA_VERSION` constant is defined in `src/constants.ts`.
- [ ] R2 risk row updated to **Mitigated** in the Risks table above.

**Planned Tests:**

- [ ] **Unit**: schema test — assert `schemaVersion` defaults to `"1"` and round-trips through JSON.
- [ ] **Integration**: `tests/integration/services/flow_checkpoint_test.ts` — add case: write a checkpoint file with `schemaVersion: "0"`, start flow, assert `flow.checkpoint.stale` event fired and step was not restored.

---

### Step 63.11 (G6): Stable LIFO Sort for Same-Wave Steps

- **Action**: Extend `IStepResult` with an optional `waveIndex: number` field populated in `processWaveResults`; update `executeCompensatingTransactions` to sort by `(waveIndex DESC, completedAt DESC)` as a two-key stable comparator.
- **Files**: `src/flows/flow_runner.ts` (`IStepResult`, `processWaveResults`, `executeCompensatingTransactions`).
- **Architecture Notes**: `waveIndex` is set when `stepResults.set(stepId, result)` is called in `processWaveResults` (the settled loop already has `waveIndex` in scope). No schema change to `ZFlowCheckpoint` — `waveIndex` is runtime-only and not persisted.

**Success Criteria:**

- [ ] Two steps in the same wave with identical `completedAt` milliseconds are compensated in deterministic reverse-declaration order (later wave position first).
- [ ] The `setTimeout(r, 5)` workaround in `37_multi_step_recovery_test.ts` is removed; test still passes.

**Planned Tests:**

- [ ] **Integration**: `tests/integration/services/flow_compensation_test.ts` — add case: two parallel steps in the same wave, then a failing step; assert LIFO order without relying on wall-clock gaps.
- [ ] **Integration**: `tests/integration/37_multi_step_recovery_test.ts` — remove `setTimeout` workaround; confirm test still asserts LIFO compensation order.

---

### Step 63.12 (G5): Recovery Metadata Fields on `IStepResult`

- **Action**: Extend `IStepResult` with optional boolean/number fields: `wasRetried?: boolean`, `retryCount?: number`, `fallbackUsed?: boolean`, `compensationRan?: boolean`. Populate them in `handleStepFailureRecovery` and `executeCompensatingTransactions`.
- **Files**: `src/flows/flow_runner.ts` (`IStepResult` interface + recovery methods).
- **Architecture Notes**: These fields are runtime-only and do not need to be persisted in `IFlowStepResultSnapshot` (checkpoint only stores successful steps). No schema migration needed.

**Success Criteria:**

- [ ] A step that succeeded after 2 retries has `wasRetried: true, retryCount: 2` in its `IStepResult`.
- [ ] A step that succeeded via its fallback has `fallbackUsed: true`.
- [ ] A step whose compensations ran has `compensationRan: true`.
- [ ] A step that succeeded on the first attempt has all three fields `undefined`.

**Planned Tests:**

- [ ] **Unit**: `tests/flows/flow_runner_test.ts` — extend the existing retry test to assert `result.stepResults.get("step1")?.wasRetried === true` and `retryCount === 2`.
- [ ] **Unit**: extend the existing fallback test to assert `fallbackUsed === true` on the primary step result.

---

### Step 63.13 (G7 + G9): Checkpoint Event Assertions and Stale-Hash Integration Test

- **Action**: Extend `tests/integration/services/flow_checkpoint_test.ts` with two new test cases.
- **Files**: `tests/integration/services/flow_checkpoint_test.ts` only.

**Test case 1 — `flow.checkpoint.cleared` assertion:**
In the existing successful-resume test, add:

```typescript
const clearedEvent = resumedLogger.events.find(e => e.event === "flow.checkpoint.cleared");
assertEquals(clearedEvent !== undefined, true);
```

**Test case 2 — stale-hash invalidation:**

Modify the flow definition after the first run (e.g., add a step), re-run `FlowRunner`, and assert:

- `flow.checkpoint.stale` event is emitted.
- Step 1 is re-executed (not skipped).
- Checkpoint file does not exist partway through (cleared on stale detection).

**Success Criteria:**

- [ ] `flow.checkpoint.cleared` is asserted in the resume test.
- [ ] A flow restart with a changed definition triggers `flow.checkpoint.stale` and full re-execution.
- [ ] Both new test cases pass `deno task test`.

**Planned Tests:**

- [ ] See test cases above — no new files; amendments to `tests/integration/services/flow_checkpoint_test.ts`.

---

### Step 63.14 (G7 — fallback test coverage): Fallback Step `onError` Hidden-by-Setup Fix

- **Action**: Add a test case that explicitly passes a fallback step with `onError: { action: RETRY }` and verifies retries fire for it. This test will fail until Step 63.8 is implemented.
- **Files**: `tests/flows/flow_runner_test.ts`.
- **Architecture Notes**: Mark with `// TODO G8: this test will pass once Step 63.8 lands` until Step 63.8 is done.

**Success Criteria:**

- [ ] Test exists (even if skipped/failing) before Step 63.8 begins — ensuring the gap is documented in the test suite.
- [ ] Test passes after Step 63.8 is complete.

**Planned Tests:**

- [ ] **Unit**: `"FlowRunner: fallback step with onError.RETRY fires retries (Step 63.8)"` in `tests/flows/flow_runner_test.ts`.

---

## Phase 3c Review — Traceability & Configurability

> **Performed by:** GitHub Copilot
> **Workflow:** `#post-gap-analysis` Phase 3c
> **Scope:** Event naming constants, payload typing, audit chain completeness, config-driven values

### Phase 3c Gap Summary

| ID | Gap (short) | Severity | Checklist Item | In Tests? |
| --- | ----------- | -------- | -------------- | --------- |
| G10 | All flow event name strings are inline literals — at least 11 strings, no constants in `constants.ts` | 🟡 Traceability | Event naming constants | ❌ |
| G11 | `IFlowEventLogger.log()` payload type is `Record<string, JSONValue \| undefined>` — completely untyped | 🟡 Traceability | Event payload typing | ❌ |
| G12 | `backoffMs: 1000` inline default in `ZFlowStep` schema and test fixtures — no named constant | 🟡 Configurability | Config-driven vs. hardcoded | ❌ |
| G13 | `maxRetries` bounds `min(1).max(5)` inline in `ZFlowStepOnError` — no named constants | 🟡 Configurability | Config-driven vs. hardcoded | ❌ |
| G14 | No test asserting checkpoint event payload fields (saved/loaded) | 🟠 Traceability | Event assertions in tests | ❌ |

### Phase 3c Detailed Gap Entries

#### G10 — 🟡 Traceability: Flow event name strings are inline literals

**Evidence:** Every `eventLogger.log(...)` call in `src/flows/flow_runner.ts` uses a string literal, not a named constant:

| Location | Inline string |
| --- | --- |
| `handleStepFailureRecovery` | `"flow.step.retry"` |
| `handleStepFailureRecovery` | `"flow.step.fallback"` |
| `executeStep` (condition skip) | `"flow.step.skipped"` (if present) |
| `saveCheckpointIfEnabled` | `"flow.checkpoint.saved"` |
| `loadCheckpointIfAvailable` | `"flow.checkpoint.loaded"` |
| `loadCheckpointIfAvailable` | `"flow.checkpoint.stale"` (emitted on stale-hash rejection) |
| `clearCheckpointOnSuccess` | `"flow.checkpoint.cleared"` |
| `executeCompensatingTransactions` | `"flow.step.compensated"` |
| `executeCompensatingTransactions` | `"flow.step.compensation_failed"` |
| `aggregateAndFinalize` | `"flow.completed"` |
| `validateIFlow` (Step 63.9) | `"flow.validation.failed"` |

`FlowRunner` imports only `DEFAULT_COST_PRECISION_FACTOR`, `DEFAULT_UNKNOWN_ERROR_MESSAGE`, `DEFAULT_UNKNOWN_LABEL` from `src/shared/constants.ts` — no flow event name constants exist anywhere.

**Impact:** A typo in any of these 11 strings silently produces a mismatched journal entry. The `flow.checkpoint.cleared` assertion gap (G7, Step 63.13) is a direct consequence — if the event name were a constant, grep-based test coverage scanning would catch its absence immediately.

---

#### G11 — 🟡 Traceability: `IFlowEventLogger.log()` payload is untyped

**Evidence:** `src/flows/flow_runner.ts`:

```typescript
export interface IFlowEventLogger {
  log(event: string, payload: Record<string, JSONValue | undefined>): void;
}
```

Every payload is an ad-hoc object. Changing `"flowRunId"` to `"flow_run_id"` in a single emitter would not produce a TypeScript error. The retry payload (`flowRunId`, `stepId`, `attempt`, `error`, `maxRetries`) and checkpoint payload (`flowRunId`, `flowId`, `traceId`, `requestId`, `completedSteps`) are defined only by convention.

**Impact:** Refactors of payload field names are invisible to the type system. The `flow.step.retry` event assertion in `flow_runner_test.ts` uses raw string key access (`retryEvents[0].payload.attempt`) — a rename would produce runtime `undefined` instead of a type error.

---

#### G12 — 🟡 Configurability: `backoffMs: 1000` inline default — no named constant

**Evidence:** `src/shared/schemas/flow.ts` defines the `ZFlowStep` schema with `retry.backoffMs` default as an inline literal. Test fixtures in `tests/flows/flow_runner_test.ts`, `tests/integration/services/flow_checkpoint_test.ts`, and `tests/integration/services/flow_compensation_test.ts` all hardcode `backoffMs: 1000`. Step 63.6 will add `backoffMs` to `ZFlowStepOnError` also as an inline default `1000`.

**Impact:** `1000` appears in at least 15 locations across test files and schema code. A policy decision to change the default (e.g., to `500ms` for faster test feedback or `2000ms` for production hardening) requires a global search-and-replace.

---

#### G13 — 🟡 Configurability: `maxRetries` bounds inline in `ZFlowStepOnError` schema

**Evidence:** `src/shared/schemas/flow.ts`:

```typescript
maxRetries: z.number().int().min(1).max(5).optional().default(1),
```

The bounds `1` and `5` are inline literals. The default `1` is also inline. No constants `FLOW_MAX_RETRIES_MIN`, `FLOW_MAX_RETRIES_MAX`, `DEFAULT_FLOW_MAX_RETRIES` exist in `src/shared/constants.ts`.

**Impact:** The risk table R3 caption says "Cap `maxRetries` at 5 in schema" — the rationale (prevent retry storms) makes the `5` a policy decision, not an arbitrary number. Policy-significant values should be named constants so they appear in a single source of truth.

---

#### G14 — 🟠 Traceability: No test asserting checkpoint event payload fields

**Evidence:** Existing checkpoint tests assert:

- `firstRunLogger.events.some((entry) => entry.event === "flow.checkpoint.saved") === true` ✅ (event name only)
- `flow.checkpoint.loaded` event emitted on resume ✅ (event name only)

No test asserts the payload fields on either event:

- `flow.checkpoint.saved` expected payload: `{ flowRunId, flowId, traceId, requestId, completedSteps }`
- `flow.checkpoint.loaded` expected payload: `{ flowRunId, flowId, traceId, requestId, restoredSteps }`

The planned Step 63.13 (G7 + G9) adds a `flow.checkpoint.cleared` assertion but still does not assert payload fields for `saved` or `loaded`.

**Impact:** A refactor of `saveCheckpointIfEnabled` that drops `completedSteps` from the payload (e.g., in error) would produce no test failure. The audit trail for checkpoint operations is partially validated.

---

### Phase 3c Gap Remediation

#### Step 63.15 (G10): Extract Flow Event Names to Constants

- **Action**: In `src/shared/constants.ts`, add a `// Flow event names` block:

  ```typescript
  export const FLOW_EVENT_STEP_RETRY = "flow.step.retry";
  export const FLOW_EVENT_STEP_FALLBACK = "flow.step.fallback";
  export const FLOW_EVENT_STEP_SKIPPED = "flow.step.skipped";
  export const FLOW_EVENT_STEP_COMPENSATED = "flow.step.compensated";
  export const FLOW_EVENT_STEP_COMPENSATION_FAILED = "flow.step.compensation_failed";
  export const FLOW_EVENT_CHECKPOINT_SAVED = "flow.checkpoint.saved";
  export const FLOW_EVENT_CHECKPOINT_LOADED = "flow.checkpoint.loaded";
  export const FLOW_EVENT_CHECKPOINT_CLEARED = "flow.checkpoint.cleared";
  export const FLOW_EVENT_CHECKPOINT_STALE = "flow.checkpoint.stale";
  export const FLOW_EVENT_COMPLETED = "flow.completed";
  export const FLOW_EVENT_VALIDATION_FAILED = "flow.validation.failed";
  ```

  Then replace all inline string literals in `src/flows/flow_runner.ts` with the corresponding constants.

- **Architecture Notes**: Follows the `DEFAULT_AGENT_*` / `AGENT_EVENT_*` pattern established by Phase 61 Step 61.10. Constants must be importable from `src/shared/constants.ts` (not from a flow-specific module) so that test files and other services can reference them without importing `FlowRunner`. This step must be completed before Step 63.9 (`validateIFlow`) emits `FLOW_EVENT_VALIDATION_FAILED`.

- **Planned Tests**:
  - **Unit**: `tests/flows/flow_runner_test.ts` — import `FLOW_EVENT_STEP_RETRY` and convert `retryEvents[0].event === "flow.step.retry"` to `retryEvents[0].event === FLOW_EVENT_STEP_RETRY` (type-safe constant reference).
  - **Integration**: `tests/integration/services/flow_checkpoint_test.ts` — replace inline `"flow.checkpoint.saved"` and `"flow.checkpoint.loaded"` string comparisons with `FLOW_EVENT_CHECKPOINT_SAVED` / `FLOW_EVENT_CHECKPOINT_LOADED` constants.

- **Success Criteria**:
  - [ ] All 11 flow event name constants are exported from `src/shared/constants.ts`.
  - [ ] Zero inline flow event name string literals remain in `src/flows/flow_runner.ts`.
  - [ ] All existing event-assertion tests pass after the constant substitution.

---

#### Step 63.16 (G12, G13): Extract Retry Numeric Defaults to Constants

- **Action**: In `src/shared/constants.ts`, add:

  ```typescript
  export const DEFAULT_FLOW_STEP_BACKOFF_MS = 1000;
  export const FLOW_MAX_RETRIES_MIN = 1;
  export const FLOW_MAX_RETRIES_MAX = 5;
  export const DEFAULT_FLOW_MAX_RETRIES = 1;
  ```

  Update `src/shared/schemas/flow.ts` `ZFlowStepOnError` to use these constants:

  ```typescript
  maxRetries: z.number().int().min(FLOW_MAX_RETRIES_MIN).max(FLOW_MAX_RETRIES_MAX).optional().default(DEFAULT_FLOW_MAX_RETRIES),
  ```

  Update Step 63.6's `ZFlowStepOnError.backoffMs` addition to use `DEFAULT_FLOW_STEP_BACKOFF_MS` as the `.default()` value. Update test fixtures in `flow_runner_test.ts`, `flow_checkpoint_test.ts`, and `flow_compensation_test.ts` to replace `backoffMs: 1000` with `backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS`.

- **Architecture Notes**: The `backoffMs: 1000` default in `ZFlowStep.retry` (the step-execution retry — distinct from `ZFlowStepOnError` retry) should also use `DEFAULT_FLOW_STEP_BACKOFF_MS`. This step must be coordinated with Step 63.6 (which adds `backoffMs` to `ZFlowStepOnError`) to avoid introducing a new inline default.

- **Planned Tests**:
  - **Unit**: `tests/flows/flow_step_on_error_schema_test.ts` — add assertion that `ZFlowStepOnError.parse({ action: "retry" }).backoffMs === DEFAULT_FLOW_STEP_BACKOFF_MS` and `ZFlowStepOnError.parse({ action: "retry", maxRetries: 10 })` fails (above `FLOW_MAX_RETRIES_MAX`).

- **Success Criteria**:
  - [ ] `src/shared/constants.ts` exports `DEFAULT_FLOW_STEP_BACKOFF_MS`, `FLOW_MAX_RETRIES_MIN`, `FLOW_MAX_RETRIES_MAX`, `DEFAULT_FLOW_MAX_RETRIES`.
  - [ ] `ZFlowStepOnError` uses constants for all `.min()`, `.max()`, and `.default()` values.
  - [ ] Zero inline `1000` backoff literals and zero inline `1`/`5` retry-bound literals remain in `src/shared/schemas/flow.ts`.

---

#### Step 63.17 (G14): Assert Checkpoint Event Payload Fields

- **Action**: In `tests/integration/services/flow_checkpoint_test.ts`, extend the existing checkpoint-saved assertion and the resume (checkpoint-loaded) assertion to verify payload fields:

  For `flow.checkpoint.saved`:

  ```typescript
  const savedEvent = firstRunLogger.events.find(e => e.event === FLOW_EVENT_CHECKPOINT_SAVED);
  assertExists(savedEvent);
  assertEquals(typeof savedEvent.payload.flowRunId, "string");
  assertEquals(savedEvent.payload.traceId, traceId);
  assertEquals(typeof savedEvent.payload.completedSteps, "number");
  assert((savedEvent.payload.completedSteps as number) >= 1);
  ```

  For `flow.checkpoint.loaded`:

  ```typescript
  const loadedEvent = resumedLogger.events.find(e => e.event === FLOW_EVENT_CHECKPOINT_LOADED);
  assertExists(loadedEvent);
  assertEquals(loadedEvent.payload.traceId, traceId);
  assertEquals(typeof loadedEvent.payload.restoredSteps, "number");
  assert((loadedEvent.payload.restoredSteps as number) >= 1);
  ```

- **Architecture Notes**: No source code changes required — payloads are already emitted with the expected fields. This step adds test coverage only. Coordinate with Step 63.13 (G7+G9) which adds the `cleared` and stale-hash tests — all three can land in the same PR.

- **Planned Tests**:
  - **Integration**: `tests/integration/services/flow_checkpoint_test.ts` — extend existing test with payload field assertions shown above.

- **Success Criteria**:
  - [ ] `flow.checkpoint.saved` payload fields `flowRunId`, `traceId`, `completedSteps` are asserted.
  - [ ] `flow.checkpoint.loaded` payload fields `traceId`, `restoredSteps` are asserted.
  - [ ] Tests pass `deno task test` without modification to `src/flows/flow_runner.ts`.

---

### Step 63.5: Documentation Updates

- **Action**: Update all external documentation surfaces affected by the Phase 63 implementation and the gap-remediation additions above.
- **Justification**: Required by [planning/README.md §3D](README.md#documentation-updates-mandatory) — public interfaces (`IStepResult`, `ZFlowStepOnError`, `ZFlowCheckpoint`), architecture (new `FlowCheckpointService` component), and cross-reference mappings were introduced but not yet documented.

#### A. `ARCHITECTURE.md`

In the component table (§ "System Components"), add three rows after the `Flow Runner` row:

```markdown
| **Flow Checkpoint Service** | Persist and resume completed flow steps | `src/services/flow/flow_checkpoint_service.ts:FlowCheckpointService` | 🟢 All |
| **Flow Step On-Error**      | Per-step RETRY/FALLBACK/COMPENSATE/ABORT policy | `src/shared/schemas/flow.ts:ZFlowStepOnError` | 🟢 All |
| **Compensating Transactions** | LIFO rollback tool-calls on step failure | `src/flows/flow_runner.ts:FlowRunner.executeCompensatingTransactions` | 🟢 All |
```

Add a `## Flow Error Recovery` subsection under the `Flow Runner` architecture section describing the four `onError` actions, checkpoint lifecycle, and compensation LIFO order.

#### B. `.copilot/cross-reference.md`

Add task-row:

```markdown
| Flow error recovery / checkpointing | [source/exaix.md](source/exaix.md) | [planning/phase-63-flow-error-recovery.md](planning/phase-63-flow-error-recovery.md) |
```

Add topic entries:

```text
- **`flow-error-recovery`** → [source/exaix.md](source/exaix.md), [planning/phase-63-flow-error-recovery.md](planning/phase-63-flow-error-recovery.md)
- **`checkpointing`** → [source/exaix.md](source/exaix.md), [planning/phase-63-flow-error-recovery.md](planning/phase-63-flow-error-recovery.md)
- **`compensation`** → [source/exaix.md](source/exaix.md), [planning/phase-63-flow-error-recovery.md](planning/phase-63-flow-error-recovery.md)
- **`onError`** → [source/exaix.md](source/exaix.md), [planning/phase-63-flow-error-recovery.md](planning/phase-63-flow-error-recovery.md)
```

#### C. New developer-facing doc: `docs/dev/`

Create a developer-facing reference covering:

- The four `onError` actions with YAML examples.
- Checkpoint file location (`Memory/Execution/{traceId}/checkpoint.json`), triggers, and stale-hash invalidation.
- Compensation LIFO ordering and portal-arg injection.
- Recovery metadata fields on `IStepResult` (after Step 63.12).

**Success Criteria:**

- [ ] `ARCHITECTURE.md` component table contains all three new rows.
- [ ] `ARCHITECTURE.md` has a `## Flow Error Recovery` subsection.
- [ ] `.copilot/cross-reference.md` has the new task-row and four topic entries.
- [ ] `docs/dev/flow_error_recovery.md` exists and passes `deno task check:docs`.
- [ ] `deno task docs-agent-validate` exits 0.
