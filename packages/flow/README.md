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

## Error Recovery

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

Configuration per request, portal, or blueprint:

```toml
[portal.my-app.session_delegate]
enabled = true
tool = "open-code"
stages = ["refinement", "code_changes"]
```

## See Also

- [@exaix/execution](../../packages/execution/) — Plan execution engine
- [@exaix/request](../../packages/request/) — Request processing that triggers flows
- [@exaix/quality-gate](../../packages/quality-gate/) — Quality gate evaluation services
