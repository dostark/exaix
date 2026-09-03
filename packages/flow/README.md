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

Exaix embeds session-oriented agent tools (OpenCode, Claude Code, Cursor, Codex) as optional delegates at pipeline gates:

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
tool = "opencode"            # claude-code | opencode | codex | cursor | vscode
gates = ["refinement", "code_changes"]   # refinement | plan_review | code_changes | review
launch_mode = "advisory"     # advisory (Mode 1) | supervised (Mode 2) | headless (Mode 3)
```

> The legacy `stages` key is accepted as a deprecated alias for `gates`. Only
> `claude-code`/`opencode` support `supervised` launch (`codex` is headless-only, Mode 3
> only); `cursor`/`vscode` are advisory-only.

### Headless Mode (Mode 3) — OpenCode First-Class Support

When `launch_mode = "headless"`, the daemon spawns the tool non-interactively. OpenCode,
Claude Code, and Codex use different CLI flags:

| Tool          | Headless command                                                                           |
| ------------- | ------------------------------------------------------------------------------------------ |
| `claude-code` | `claude -p <objective> --brief <path> --max-total-tokens <n> --output-format json`         |
| `opencode`    | `opencode run --format json <objective>` (does NOT support `--brief`/`--max-total-tokens`) |
| `codex`       | `codex exec --json <objective>` (does NOT support `--brief`/`--max-total-tokens`)          |

**OpenCode stdout capture:** Since `opencode run` does not write `return.json` natively, the
`HeadlessSessionLauncher` captures stdout, parses newline-delimited JSON events
(`type: "text"` for the response, `type: "step_finish"` for token stats), and synthesizes
a schema-valid `return.json`. This allows OpenCode to be a first-class headless
delegation target without requiring a wrapper script.

#### Environment Variable Override (Phase 111)

For CI and E2E testing, the `[session_delegate]` TOML config can be overridden by
environment variables. This is useful when running the same scenario in both
API-LLM and CLI-delegation modes:

| Env var                              | Purpose                                                    | Example                   |
| ------------------------------------ | ---------------------------------------------------------- | ------------------------- |
| `EXA_SESSION_DELEGATE_ENABLED`       | Master switch (default gates: `refinement`, `plan_review`) | `true`                    |
| `EXA_SESSION_DELEGATE_TOOL`          | Override the session tool                                  | `opencode`                |
| `EXA_SESSION_DELEGATE_GATES`         | Comma-separated gate list                                  | `refinement,code_changes` |
| `EXA_SESSION_DELEGATE_BIN_OVERRIDES` | Comma-separated binary paths added to allowlist            | `/path/to/mock_bin`       |

When `EXA_SESSION_DELEGATE_ENABLED=true`, the default gates are `refinement` and `plan_review`.
The `code_changes` and `review` gates require **explicit opt-in** via config or
`EXA_SESSION_DELEGATE_GATES`, because `code_changes` intercepts all plan step execution.

#### Dual-Mode Test Pattern

The same scenario can be run in both modes by toggling env vars:

```bash
# Mode 1: Pure API LLM
deno test --filter "Plan Amendment" tests/scenario_framework/

# Mode 2: API LLM + CLI delegation for refinement/plan_review
EXA_SESSION_DELEGATE_ENABLED=true \
  EXA_SESSION_DELEGATE_TOOL=opencode \
  deno test --filter "Plan Amendment" tests/scenario_framework/

# Mode 3: Full CLI delegation
EXA_SESSION_DELEGATE_ENABLED=true \
  EXA_SESSION_DELEGATE_TOOL=opencode \
  EXA_SESSION_DELEGATE_GATES=refinement,code_changes \
  deno test --filter "session-delegate" tests/scenario_framework/
```

#### Building the Mock Binary for CI

```bash
deno task build:mock-tool   # compiles .cache/mock_session_tool_bin
```

## Session Delegate Cycle

`type: session_delegate_cycle` (Phase 174) is a distinct `IFlowStepHandler`
(`SessionDelegateCycleStepHandler`) that drives **N** of the single-shot handoffs above in
strict sequence — one hardened-plan step at a time, each reviewed before the next starts —
instead of handing one whole step to an unsupervised `cli_delegate` session. It is the
production mechanism behind `Blueprints/Flows/dogfood-meta-workflow.flow.yaml:next-steps`.

### Configuration

```yaml
steps:
  - id: next-steps
    type: session_delegate_cycle
    agent_role: dogfood-coder # the agent_role threaded through to the delegate's hardened launch
    input:
      source: request
      transform: passthrough # request must carry plan_context_ref; no static plan path
    delegateCycle:
      requireChangedPaths: true # non-empty paths_touched required (currently always true)
      review:
        agent_role: quality-judge
        criteria: [code_correctness, has_tests, task_fulfillment]
        threshold: 0.8
        onFail: halt # only halt is accepted for this step type
        maxRetries: 3 # accepted but unused — see onFail below
        includeRequestCriteria: false
```

The plan itself is never embedded in the flow YAML or request prose: `plan_context_ref` (set by
`RequestProcessor`/`plan_context_resolver.ts`) names a path relative to the request's configured
portal root, and both the portal root and the reference are validated before the cycle's first
launch — request text or flow YAML cannot substitute a different plan or escape the portal.

### Result / Status Mapping

Each sequence resolves to one of the `ISessionDelegateCycleRejectionReason` values on failure
(`plan_too_large`, `too_many_steps`, `plan_parse_failed`, `non_completed_status`,
`empty_paths_touched`, `review_failed`, `checkpoint_mismatch`) or advances on success — a
successful delegation whose `IGateEvaluator` review also passes. The reason is deliberately
categorical, never free text: it is safe to journal without risk of leaking prompt content or
host paths. A checkpoint's `status` field (`SessionDelegateCycleCheckpointStatusSchema`) tracks
`running` / `completed` / `failed` across the whole cycle, independent of any single sequence's
outcome.

### Restart Behavior

A SQLite-backed claim store (`ISessionDelegateCycleClaimStore`) is the launch source of truth: a
unique `(parentTraceId, parentStepId, sequence, planDigest)` key means at most one durable
launch exists per idempotency tuple, across crash points and duplicate handler/watcher entry. An
atomic JSON checkpoint (`ISessionDelegateCycleStore`, one file per `{parentTraceId}/{flowStepId}`
under `Memory/Execution/`) mirrors `completedSteps` and the current `inFlight` step for cheap
resume without re-scanning claims. On restart the handler:

- **Resumes** a matching `running` checkpoint (`session.delegate.cycle_resumed`), continuing from
  the first incomplete sequence.
- **Replays** an already-`completed` checkpoint idempotently — zero relaunches.
- **Rejects** (`checkpoint_mismatch`) a checkpoint whose identity or `planDigest` no longer
  matches the current attempt, or one already terminally `failed` — never silently overwriting
  that evidence.

### Failure Semantics

Any failure class — a hollow/rejected delegate return, a failed review, a plan-parse error, an
oversized or too-long plan, or a checkpoint mismatch — halts the cycle before any further
coordinator call. There is no partial credit and no silent re-plan: a halted cycle's checkpoint
remains immutable evidence of what actually completed, and the flow step fails through the
normal flow failure path rather than continuing with a different or skipped step.

**`onFail`/`maxRetries`:** `review.onFail`/`review.maxRetries` are part of the shared
`GateEvaluateSchema` other gate-driven step types also use, but
`SessionDelegateCycleStepHandler` calls `IGateEvaluator.evaluate(...)` with a hardcoded
`previousAttempts` of `0` and halts unconditionally on any failed review — it does not inspect
`onFail`/read `maxRetries`/re-attempt the same sequence. Since retry was never implemented,
`SessionDelegateCycleConfigSchema` rejects `onFail: retry` and `onFail: continue-with-warning`
at validation time (Phase 174 Step 10/GAP-4) — `session_delegate_cycle`'s `review.onFail`
accepts only `halt`, so the schema can never promise a capability the step handler does not
have. `maxRetries` is still accepted (inherited from the shared schema) but has no effect.

## See Also

- [@exaix/session](../../packages/session/) — Session-delegation handoff contract

- [@exaix/execution](../../packages/execution/) — Plan execution engine
- [@exaix/request](../../packages/request/) — Request processing that triggers flows
- [@exaix/quality-gate](../../packages/quality-gate/) — Quality gate evaluation services
