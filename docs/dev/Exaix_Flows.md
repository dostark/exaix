# Exaix Flows

This guide consolidates the developer-facing flow runtime topics that were
previously split across separate documents. It focuses on how Exaix flows are
declared, executed, recovered, coordinated through shared namespace state, and
reported after execution.

Use `ARCHITECTURE.md` for the system-level placement of these components. This
document is the canonical detailed reference for flow runtime behavior,
configuration, and execution artifacts.

## Flow Model Overview

Flows orchestrate multiple identities through a declarative YAML shape. A flow
declares steps, dependencies, input routing, output aggregation, and optional
runtime features such as error recovery and shared namespace coordination.

Core runtime responsibilities:

- `FlowRunner` executes dependency waves and aggregates step outputs.
- `FlowCheckpointService` persists resume state for successful steps.
- `FlowNamespaceService` provides shared blackboard persistence across steps.
- `FlowReporter` writes markdown execution reports for completed runs.

## Execution Model

Flows execute in dependency waves.

- Steps with no unmet dependencies can run in parallel in the same wave.
- Downstream steps wait until all required upstream steps have settled.
- Successful step results are retained in memory for transforms, output
  aggregation, recovery, and reporting.

### Parallel Execution Groups

Phase 65 adds explicit parallel group declarations and fan-in merge semantics
to the flow schema and execution engine. This turns implicit concurrency into
explicit, auditable, testable orchestration.

#### Group Declaration

Steps that share a `parallel.group` ID and are in the same dependency wave
execute concurrently via `Promise.allSettled`:

```yaml
steps:
  - id: review-security
    name: Security review
    identity: security-reviewer
    parallel:
      group: review
    input:
      source: request

  - id: review-style
    name: Code style review
    identity: technical-writer
    parallel:
      group: review
    input:
      source: request
```

#### Fan-In Merge

Downstream steps collect results from named groups via `mergeFromGroups`. The
`mergeMode` controls how per-step outputs are aggregated:

| Mode      | Behavior                                              |
| --------- | ----------------------------------------------------- |
| `all`     | Concatenates all successful step outputs (default)    |
| `ordered` | Concatenates in explicit `parallel.order` sequence    |
| `concat`  | Same as `all` — retained for backward compatibility   |
| `manual`  | No automatic merge; raw per-step results exposed only |

```yaml
- id: synthesize-review
  name: Synthesize review report
  identity: technical-writer
  dependsOn: [review-security, review-style]
  mergeFromGroups: [review]
  mergeMode: ordered
  parallel:
    order: [review-security, review-style]
  input:
    source: request
```

#### Merged Output Injection

When a step declares `mergeFromGroups`, `FlowRunner.prepareStepRequest()`
injects a `parallelGroupResults` top-level field on `IFlowStepRequest`:

```typescript
interface IParallelGroupSummary {
  groupId: string;
  mergedOutput: string;
  memberCount: number;
  successCount: number;
  completedAt: string; // ISO string
}

parallelGroupResults: Record<string, IParallelGroupSummary>;
```

Date fields (`startedAt`, `completedAt`) from `IStepResult` are serialized to
ISO strings before injection — `IFlowStepRequest.context` (typed as
`Record<string, JSONValue>`) is not used for group results.

#### Group Lifecycle Events

Group execution emits journal events via `IFlowEventLogger`:

| Event                              | Payload                                                         |
| ---------------------------------- | --------------------------------------------------------------- |
| `flow.parallel_group.started`      | `{ groupId, stepIds, waveIndex, traceId? }`                     |
| `flow.parallel_group.completed`    | `{ groupId, successCount, failureCount, durationMs, traceId? }` |
| `flow.parallel_group.merge_failed` | `{ groupId, mergeMode, error, traceId? }`                       |

Event names are defined as constants in `src/shared/constants.ts`:
`FLOW_EVENT_PARALLEL_GROUP_STARTED`, `FLOW_EVENT_PARALLEL_GROUP_COMPLETED`,
`FLOW_EVENT_PARALLEL_GROUP_MERGE_FAILED`.

#### Execution Artifacts

Execution artifacts are stored under:

```text
Memory/Execution/{traceId}/
```

When no `traceId` is provided, runtime services fall back to the generated
`flowRunId`.

## Error Recovery

Phase 63 added flow-level recovery so a multi-step flow can preserve completed
work, retry transient failures, or roll back side effects instead of always
starting from scratch.

### Recovery Actions

Flow steps may declare one of four `onError` actions in YAML.

### `retry`

Use `retry` when the same step is safe to re-run after transient failure.

```yaml
steps:
  - id: test
    name: Run tests
    identity: qa-engineer
    input:
      source: request
    onError:
      action: retry
      maxRetries: 2
      backoffMs: 1000
```

Behavior:

- Retries run through the full step harness.
- Delays use exponential backoff from `backoffMs`.
- Successful recovery sets `IStepResult.wasRetried = true` and
  `IStepResult.retryCount`.

### `fallback`

Use `fallback` when a different step should attempt recovery.

```yaml
steps:
  - id: implement
    name: Primary implementation
    identity: senior-coder
    input:
      source: request
    onError:
      action: fallback
      fallbackStep: implement-safe

  - id: implement-safe
    name: Conservative fallback implementation
    identity: senior-coder
    dependsOn: [implement]
    condition: results['implement']?.success !== true
    input:
      source: request
    onError:
      action: retry
      maxRetries: 2
```

Behavior:

- Fallback targets must exist in the same flow definition.
- Cyclic fallback chains are rejected during validation.
- If the fallback succeeds, the primary step result is returned with
  `IStepResult.fallbackUsed = true`.

### `compensate`

Use `compensate` when earlier successful steps must be rolled back after a
later failure.

```yaml
steps:
  - id: generate
    name: Generate files
    identity: senior-coder
    input:
      source: request
    onError:
      action: compensate
      compensate:
        - tool: delete_file
          args:
            path: generated/output.ts
```

Behavior:

- Compensation runs in LIFO order across previously successful steps.
- Same-wave ties are broken by reverse declaration order.
- Rollback tool arguments receive portal or worktree context injection before
  execution.
- Successful compensated steps are marked with
  `IStepResult.compensationRan = true`.

### `abort`

Use `abort` when the flow must terminate immediately with explicit failure
context.

```yaml
steps:
  - id: verify
    name: Verify release criteria
    identity: qa-engineer
    input:
      source: request
    onError:
      action: abort
```

Behavior:

- `FlowRunner` throws `FlowAbortError`.
- The error includes the originating step id and the formatted failure result.

## Checkpointing

Successful steps are snapshotted to:

```text
Memory/Execution/{traceId}/checkpoint.json
```

Checkpoint lifecycle:

- Each successful step writes a checkpoint snapshot.
- Restarts with the same `traceId` restore prior successful step results.
- Restored steps are skipped instead of re-executed.
- Successful flow completion deletes the checkpoint.

Stale-checkpoint invalidation happens before restore when either of these
inputs changes:

- `flowContentHash`
- `FLOW_CHECKPOINT_SCHEMA_VERSION`

When invalidation occurs, `FlowRunner` emits `flow.checkpoint.stale`, deletes
the checkpoint, and reruns from step one.

## Compensation Ordering And Context Injection

Compensation operates on successful step results already recorded by the
current run.

Ordering rules:

- Later waves compensate before earlier waves.
- Within the same wave, later declared steps compensate first.
- Within a step, compensation tool calls run in their declared order.

Execution context rules:

- If the request includes a portal alias, the alias is injected into rollback
  tool arguments.
- `identity_id` is injected so MCP handlers execute in the same logical
  workspace context.
- Compensation failures are logged and do not stop the remaining rollback
  actions.

## Recovery Metadata On `IStepResult`

`FlowRunner` exposes runtime-only recovery metadata on `IStepResult`:

| Field             | Meaning                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `wasRetried`      | The step eventually succeeded after retry recovery                |
| `retryCount`      | Number of retry recovery attempts consumed before success         |
| `fallbackUsed`    | The primary logical step succeeded via a fallback step            |
| `compensationRan` | The step succeeded earlier and later participated in compensation |

These fields are not persisted inside checkpoint snapshots. Checkpoints retain
only the serializable success data needed for resume.

## Shared Namespace And Blackboard Coordination

Phase 64 added a flow-scoped shared blackboard so multi-step flows can exchange
structured findings without routing every intermediate value through transforms.
The feature is opt-in at the flow level and uses explicit per-step read and
write bindings.

### Flow-Level Configuration

Enable the namespace once per flow.

```yaml
namespace:
  enabled: true
  format: markdown
  maxBytes: 4096
```

- `enabled`: turns on namespace coordination for the flow.
- `format`: persisted artifact format. Phase 64 supports markdown and yaml
  storage.
- `maxBytes`: hard limit for the persisted namespace artifact. Writes that
  would exceed the limit fail the step.

### Step-Level Bindings

Each step declares the keys it reads and writes.

```yaml
steps:
  - id: analyze
    name: Analyze request
    identity: senior-coder
    input:
      source: request
    namespace:
      writes:
        - key: analysis.summary
          from: summary
        - key: analysis.risk
          from: risk.level

  - id: synthesize
    name: Synthesize report
    identity: technical-writer
    dependsOn: [analyze]
    input:
      source: request
    namespace:
      reads:
        - key: analysis.summary
          required: true
        - key: analysis.risk
```

### Read Bindings

- `key`: namespace key to resolve.
- `required`: when `true`, the step fails if the key is absent.

Resolved reads are injected onto `IFlowStepRequest.sharedNamespace` as a flat
`Record<string, string>` keyed by the declared namespace keys.

### Write Bindings

- `key`: namespace key to write.
- `from`: optional dot-path into the step output. When omitted, the full step
  output string is written.
- `mode`: supported by the schema for write behavior; use the default write
  behavior unless a flow explicitly needs append semantics.

### Namespace Storage Location

The namespace artifact is stored per execution trace alongside checkpoint
state:

```text
Memory/Execution/{traceId}/namespace.md
```

If a flow run does not provide a `traceId`, the runtime falls back to the
generated `flowRunId` for namespace storage.

### Namespace Runtime Behavior

- `FlowRunner` initializes the namespace before executing namespace-enabled
  flows.
- Reads are resolved during step request preparation and exposed through
  `sharedNamespace`.
- Writes are not persisted inside parallel step promises. Successful steps
  buffer write intents first.
- After a wave settles, `FlowRunner.processWaveResults()` flushes buffered
  writes serially. This prevents concurrent load-modify-write races when
  multiple steps in the same wave write to the shared blackboard.
- Failed steps do not persist namespace writes.
- Resume flows reuse the existing namespace artifact for the same `traceId`.

## Flow Reporting

When namespace support is enabled, `FlowReporter` includes:

- `namespace_artifact_path` in report frontmatter.
- A `## Shared Namespace` section containing the artifact path only.

Flow reports are written per run and summarize:

- overall success and duration
- per-step outputs and failures
- dependency graph structure
- optional namespace artifact linkage

## Related Files

- `src/flows/flow_runner.ts`
- `src/services/flow/flow_checkpoint_service.ts`
- `src/services/flow/flow_namespace_service.ts`
- `src/services/flow/flow_reporter.ts`
- `src/shared/schemas/flow.ts`
- `src/shared/constants.ts`
- `.copilot/planning/phase-63-flow-error-recovery.md`
- `.copilot/planning/phase-64-flow-namespace-blackboard.md`
- `.copilot/planning/phase-65-parallel-execution-groups.md`
