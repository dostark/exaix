# @exaix/flow

Flow orchestration, validation, and checkpoint services for Exaix.

## Role

`@exaix/flow` owns the **flow engine** — the runtime that executes multi-step agent workflows with condition evaluation, quality gates, parallel execution groups, error recovery, and checkpointing. Flows are defined in `exa.config.toml` and orchestrate agents through sequenced steps.

## Condition Expression Syntax

```typescript
// Variable access and comparison
"status == 'success'";
"count > 10";

// Logical operators
"status == 'success' && confidence >= 80";

// Step result access
"steps.validation.passed == true";
```

## Quality Gate Configuration

```yaml
step:
  type: gate
  name: code_quality_gate
  condition: "score >= 80"
  onPass: continue
  onFail:
    action: feedback
    maxRetries: 3
  criteria:
    - CODE_CORRECTNESS
    - HAS_TESTS
```

## Wait States

Durable wait states allow a flow to pause at a quality gate when an operator
decision is required, then resume once the operator approves, rejects, or amends
the decision via CLI or daemon API.

### Architecture Boundary

- `FlowRunner` creates a wait state via `IWaitStateService` when a gate step
  score falls below threshold and `waitStateService` is configured.
- `WaitStateService` (in-memory for tests; filesystem-backed for CLI) owns
  state transitions, expiry, and amendment linkage.
- `exactl wait` commands (`list`, `approve`, `reject`, `amend`, `expire`)
  read/write JSON files at `Workspace/WaitStates/{traceId}/{waitStateId}.json`.

### State Machine

```
pending → fulfilled   (operator approves)
pending → rejected    (operator rejects)
pending → amended     (operator amends — creates successor wait)
pending → expired     (deadline reached or operator expires)
pending → cancelled   (flow cancelled externally)
amended → resumed     (amending wait resolved)
amended → amended     (nested amendment)
```

### Configuration

```typescript
interface IFlowRunnerConfig {
  waitStateService?: IWaitStateService; // optional, no-op by default
}
```

### Journal Events

| Event               | Payload Fields                                                         | When Emitted                                        |
| ------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| `flow.wait.created` | `flowRunId`, `stepId`, `waitStateId`, `resumeToken`, `kind`, `traceId` | Gate step creates a wait state on failure           |
| `flow.wait.pending` | `flowRunId`, `waitStateId`, `traceId`, `stepIds`                       | Flow pauses and saves checkpoint with pending waits |

### Amendment Loop

When a wait state is amended, a successor wait state is created. The original
is marked `amended` and the successor carries `amendmentOf` pointing to the
original. Resolving the successor auto-transitions the original to `resumed`.

## Step Durability

Step durability preserves execution records so resumed flows can skip
recomputation of prior steps through selective replay. This reduces
recomputation of expensive analytical steps (LLM calls) while preventing
silent skip of side-effecting steps (tool invocations, git operations).

### Architecture Boundary

- `FlowRunner` selects and applies replay policy during execution.
- `IStepDurabilityStore` — persistence contract for saving, querying
  (`findReplayCandidate`), and invalidating step execution records.
- `IStepReplayPolicy` — decision contract for whether a matched prior
  record may be reused. `DefaultStepReplayPolicy` allows replay for
  `StepSideEffectClass.NONE` and `StepSideEffectClass.LLM` and denies
  it for `TOOL`, `GIT`, and `MIXED`.
- The artifact-centric external model is unchanged — durability is
  internal runtime semantics only.

### Configuration

```typescript
interface IFlowRunnerConfig {
  stepDurabilityStore?: IStepDurabilityStore; // optional, no-op by default
  stepReplayPolicy?: IStepReplayPolicy; // optional, DefaultStepReplayPolicy by default
  checkpointService?: IFlowCheckpointService; // optional override for testing
}
```

### Replay Policy Defaults

| Side Effect Class | Replayable | Rationale                      |
| ----------------- | ---------- | ------------------------------ |
| `NONE`            | ✅ Yes     | No external side effects       |
| `LLM`             | ✅ Yes     | Purely analytical (idempotent) |
| `TOOL`            | ❌ No      | May have external side effects |
| `GIT`             | ❌ No      | Git state mutation             |
| `MIXED`           | ❌ No      | Combination of the above       |

### Match Keys

`findReplayCandidate` matches stored records on:

- `traceId`, `flowId`, `stepId` — execution identity
- `inputHash` — SHA-256 of serialized step request; exact match required
- `attemptClass` — e.g. `INITIAL`, `RETRY`, `FALLBACK`
- Optional: `toolPolicyHash`, `portalScopeHash`

### Checkpoint Migration

When `loadCheckpointIfAvailable` restores steps from a valid checkpoint, it
backfills the durability store with one audit-only record per restored step
(`inputHash: ""`, `replayEligible: false`, `disposition: executed`,
`attemptClass: resume`). These records are informational — the empty hash
prevents `findReplayCandidate` from matching them for automatic replay.

A session-scoped `migratedCheckpointTraceIds` set on the `FlowRunner`
instance prevents double-backfill when `execute()` is called more than once
with the same `traceId`.

When a **stale** checkpoint is detected (schema version or flow content hash
mismatch), it is discarded and `DomainEventType.FlowStepInvalidated` is emitted for
each step that was in the stale checkpoint, then `store.invalidate()` is
called with a synthetic record ID (`stale:<traceId>:<stepId>`).

### Journal Events

| Event                        | Payload Fields                                                   | When Emitted                                     |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| `flow.step.skipped_by_reuse` | `flowRunId`, `stepId`, `priorRecordId`, `inputHash`, `traceId`   | Prior record matched and policy permits reuse    |
| `flow.step.replayed`         | `flowRunId`, `stepId`, `recordId`, `reason`, `traceId`, `flowId` | Reserved — future result-reconstruction path     |
| `flow.step.invalidated`      | `flowRunId`, `stepId`, `recordId`, `reason`, `traceId`           | Stale checkpoint discarded or record invalidated |

### Invariants

- Artifact-centric model unchanged — durability is internal runtime semantics.
- Replay is conservative by default (only `NONE` / `LLM` steps).
- `replayEligible` is initialized `false` at record construction; flipped to
  `true` only after the step's success branch completes.
- `durationMs` (wall-clock milliseconds) is computed and stored on every
  successful execution record.
- Output reconstruction uses `IStepExecutionRecord.summary` from prior
  execution.
- No new record is created when replaying; the prior record is reused in place.

## Error Recovery

`FlowRunner` includes recovery controls so a multi-step flow can preserve
completed work, retry transient failures, or unwind prior side effects
instead of always restarting from scratch.

### Architecture Boundary

- `FlowRunner` selects and applies recovery strategy during execution.
- `FlowCheckpointService` owns resume snapshots and stale-checkpoint invalidation.
- Recovery metadata is runtime state on step results rather than part of
  the persisted flow definition.

### Recovery Actions

| Action       | Behavior                                                      |
| ------------ | ------------------------------------------------------------- |
| `RETRY`      | Re-execute the failed step (up to `maxRetries`), with backoff |
| `FALLBACK`   | Execute a fallback step or identity, then continue            |
| `COMPENSATE` | Unwind side effects (LIFO), then mark flow as compensated     |
| `ABORT`      | Halt the entire flow immediately                              |

### Checkpoint Lifecycle

- `FlowCheckpointService` creates a snapshot after each successful step
- On resume, loads latest checkpoint, verifies step-ID sequence continuity, replays only unexecuted steps
- Stale checkpoints invalidated when flow definition hash changes
- Compensations execute in LIFO order

## Parallel Execution Groups

Steps that share a `parallel.group` ID within the same dependency wave
execute concurrently via `Promise.allSettled`, and downstream steps
aggregate results through configurable merge modes.

### Architecture Boundary

- `FlowRunner` owns group detection, concurrent execution, and fan-in aggregation.
- `FlowCheckpointService` captures individual group members by step ID
  — no schema changes needed; group membership is re-derived from the
  flow definition at resume.
- Merged outputs are injected via `parallelGroupResults` on
  `IFlowStepRequest` (not inside `context`), keeping dates serialized
  to ISO strings and out of arbitrary context namespaces.

### Merge Modes

| Mode      | Behavior                                                         |
| --------- | ---------------------------------------------------------------- |
| `all`     | All parallel results concatenated into an array (default)        |
| `ordered` | Results sorted by step ID before concatenation                   |
| `concat`  | Each result's `output` field concatenated in group-ID order      |
| `manual`  | Downstream steps receive `parallelGroupResults` map, not a merge |

## Evaluation Components

| Component           | Purpose               | Key Features                                           |
| ------------------- | --------------------- | ------------------------------------------------------ |
| Condition Evaluator | Expression evaluation | Safe expression parsing, variable interpolation        |
| Gate Evaluator      | Quality checkpoints   | Pass/fail criteria, threshold validation, gate actions |
| LLM-as-a-Judge      | AI-powered assessment | Structured rubrics, multi-criteria scoring             |
| Feedback Loop       | Iterative refinement  | Max iterations, convergence detection                  |
| Evaluation Criteria | Quality standards     | Built-in + custom criteria, weighted scoring           |

### Built-in Evaluation Criteria

| Criteria                | Description                           | Use Case                  |
| ----------------------- | ------------------------------------- | ------------------------- |
| `CODE_CORRECTNESS`      | Validates syntax and semantics        | Code generation steps     |
| `HAS_TESTS`             | Ensures test coverage exists          | TDD workflows             |
| `FOLLOWS_SPEC`          | Matches specification requirements    | Implementation validation |
| `IS_SECURE`             | Checks security best practices        | Security-critical flows   |
| `PERFORMANCE_OK`        | Validates performance characteristics | Optimization workflows    |
| `GOAL_ALIGNMENT`        | Every primary goal addressed          | Goal-aware gates          |
| `TASK_FULFILLMENT`      | All stated requirements fulfilled     | Requirement-aware gates   |
| `REQUEST_UNDERSTANDING` | Correct understanding demonstrated    | Validation gates          |

## Namespace & Blackboard Coordination

A flow-scoped shared blackboard lets steps exchange structured findings
without threading every value through transforms.

### Architecture Boundary

- `FlowRunner` owns wave scheduling and when namespace reads and writes occur.
- `FlowNamespaceService` owns persistence and artifact serialization.
- Flow definitions opt into namespace coordination explicitly rather than
  enabling implicit global state.

### Runtime Behavior

Steps can share structured findings through a flow-scoped namespace:

- Declare `namespace` block in flow step YAML with `enabled`, `write_keys`, and `read_keys`
- Steps write via `context.namespace.write(key, value)` and read via `context.namespace.read(key)`
- Artifacts persisted to `Memory/Execution/{traceId}/namespace.json`
- Writes visible only to subsequent waves (same-wave reads return empty)

## Session Tool Integration

Exaix embeds session-oriented agent tools (OpenCode, Claude Code, Cursor) as optional delegates at pipeline gates:

```text
Request (file) → [Refinement] ◄ Optional: launch session tool for interactive Q&A
  → Plan Generation → [Plan Review] ◄ Optional: launch session tool to review plan
  → Execution → [Code Changes] ◄ Optional: launch session tool for interactive coding
  → Review & Merge
```

Implemented by the `@exaix/session` package (Phase 106) as a three-part
brief → launch → return handoff: Exaix writes `Session/{traceId}/brief.json`, a
per-tool adapter launches the tool (advisory print or supervised spawn), the tool
writes a mandatory `Session/{traceId}/return.json`, and reconciliation validates
scope + token, maps the outcome into the existing amendment/review/clarification
contracts, and resumes a durable wait state. Only files cross back — never
session/conversation state.

Configuration per request, portal, or blueprint (global scope shown):

```toml
[session_delegate]
enabled = true
tool = "opencode"            # claude-code | opencode | cursor | vscode
gates = ["refinement", "code_changes"]   # refinement | plan_review | code_changes | review
launch_mode = "advisory"     # advisory (Mode 1) | supervised (Mode 2)
```

> The legacy `stages` key is accepted as a deprecated alias for `gates`. Only
> `claude-code`/`opencode` support `supervised` launch; `cursor`/`vscode` are
> advisory-only.

## See Also

- [@exaix/session](../../packages/session/) — Session-delegation handoff contract

- [@exaix/execution](../../packages/execution/) — Plan execution engine
- [@exaix/request](../../packages/request/) — Request processing that triggers flows
- [@exaix/quality-gate](../../packages/quality-gate/) — Quality gate evaluation services
