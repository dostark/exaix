# Flow Error Recovery

Phase 63 adds flow-level recovery to `FlowRunner` so multi-step flows can survive partial failure without discarding already completed work. The runtime combines per-step `onError` policies, checkpoint resume, and compensating transactions.

## Recovery Actions

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
- Successful recovery sets `IStepResult.wasRetried = true` and `IStepResult.retryCount`.

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
- If the fallback succeeds, the primary step result is returned with `IStepResult.fallbackUsed = true`.

### `compensate`

Use `compensate` when earlier successful steps must be rolled back after a later failure.

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
- Rollback tool arguments receive portal/worktree context injection before execution.
- Successful compensated steps are marked with `IStepResult.compensationRan = true`.

### `abort`

Use `abort` when the flow must terminate immediately with explicit failure context.

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

Stale-checkpoint invalidation happens before restore when either of these inputs changes:

- `flowContentHash`
- `FLOW_CHECKPOINT_SCHEMA_VERSION`

When invalidation occurs, `FlowRunner` emits `flow.checkpoint.stale`, deletes the checkpoint, and reruns from step one.

## Compensation Ordering And Portal Injection

Compensation operates on successful step results already recorded by the current run.

Ordering rules:

- Later waves compensate before earlier waves.
- Within the same wave, later declared steps compensate first.
- Within a step, compensation tool calls run in their declared order.

Execution context rules:

- If the request includes a portal alias, the alias is injected into rollback tool arguments.
- `identity_id` is injected so MCP handlers execute in the same logical workspace context.
- Compensation failures are logged and do not stop the remaining rollback actions.

## Recovery Metadata On `IStepResult`

`FlowRunner` exposes runtime-only recovery metadata on `IStepResult`:

| Field             | Meaning                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `wasRetried`      | The step eventually succeeded after retry recovery                |
| `retryCount`      | Number of retry recovery attempts consumed before success         |
| `fallbackUsed`    | The primary logical step succeeded via a fallback step            |
| `compensationRan` | The step succeeded earlier and later participated in compensation |

These fields are not persisted inside checkpoint snapshots. Checkpoints only retain the serializable success data needed for resume.

## Related Files

- `src/flows/flow_runner.ts`
- `src/services/flow/flow_checkpoint_service.ts`
- `src/shared/schemas/flow.ts`
- `.copilot/planning/phase-63-flow-error-recovery.md`
