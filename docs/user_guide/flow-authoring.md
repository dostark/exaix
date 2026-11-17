# Flow Authoring

How to write a flow: step types, gates, retry loops, branches, shared namespace, capability requirements, voting steps and the shipped blueprints. Part of the [Exaix User Guide](README.md). The commands that list and run flows are in [Blueprints and Flows](blueprints-and-flows.md).

## Flow Step Types

Flows support various step types for different orchestration patterns:

| Step Type      | Purpose               | Key Features                               |
| -------------- | --------------------- | ------------------------------------------ |
| `agent`        | Execute an agent      | Agent invocation with context              |
| `gate`         | Quality checkpoint    | Judge criteria, `onFail` halt/warn/retry   |
| `branch`       | Conditional routing   | JSON output, ordered `branches`, `default` |
| `voting_group` | Multi-agent consensus | Fan-out N runners, majority/weighted/judge |

There is no `loop` or `parallel` step type. A loop is a gate with `onFail: retry` and `loop.backTo`. Parallelism is the
`parallel:` field on an agent step. `FlowSchema` rejects `type: loop` and `type: parallel`.

An LLM-calling step can declare a partial `binding` and pin specific fields. The pin reason
records why the flow author fixed those fields. A broader operator selector cannot change
them; a conflicting exact step override fails before generation.

```yaml
steps:
  - id: compose
    agent_role: composer
    binding: { service: openai-chat, model: openai/gpt-6-luna }
    pin:
      fields: [service, model]
      reason: compliance
      note: "Contracted vendor for final output"
```

See [Model bindings for flow steps](../Model_Settings.md#model-bindings-for-flow-steps) for catalog and override setup.

## Advanced Flow Controls

A flow can stop, warn or loop at a gate, route work with a branch, and require an edition capability.
The runtime enforces every control described here. Each control failure ends the run with a stable code.

**Gate failure policy.** A `gate` step judges its input. The judge settings live in `evaluate`.
Set the failure policy with `evaluate.onFail`. A gate rejects `onError` and generic `retry`:
`onError` is rejected on a gate; use `evaluate.onFail`.

| `onFail`                | When the score is below `threshold`                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `halt` (default)        | The run fails with `gate_halted`. The error carries the score, threshold and judge feedback. |
| `continue-with-warning` | The flow continues and the daemon journals a warning.                                        |
| `retry`                 | The runner re-runs the loop body with the judge feedback, then evaluates the gate again.     |

A halted gate fails the run whatever `failFast` or `continue_on_error` say. Halt is terminal:
a failed gate does not pause the flow for an operator and nothing resumes it.
Approval and resume of flow gates are not part of this contract.
A `session_delegate_cycle` review is separate and keeps its own `onFail: halt` rule.

```yaml flow
id: halting-review
name: Halting review
description: A failing review gate fails the run.
steps:
  - id: draft
    name: Draft the change
    agent_role: senior-coder
    dependsOn: []
    input: { source: request, transform: passthrough }
  - id: review-gate
    name: Judge the draft
    type: gate
    agent_role: quality-judge
    dependsOn: [draft]
    input: { source: step, stepId: draft, transform: passthrough }
    evaluate:
      agent_role: quality-judge
      criteria: [code_correctness, has_tests]
      threshold: 0.8
      onFail: halt
output:
  from: review-gate
  format: markdown
```

**Gate retry loop.** A gate with `onFail: retry` and `loop.backTo` re-runs the steps from `backTo`
up to the gate. `evaluate.maxRetries` caps the total gate evaluations, so a gate allows at most
`maxRetries - 1` loop iterations. After the last failing evaluation the gate applies `halt`.
A retrying gate needs `maxRetries` of at least 2. `loop.backTo` defaults to the gate's `input.stepId`.
`loop.maxIterations` and `loop.targetScore` are rejected on a gate: gate loops use `evaluate.maxRetries` and `threshold`.
`loop` is valid on gate steps only. `input.source: feedback` is removed. Use a gate with `onFail: retry` and `loop.backTo`.

The run-wide ceiling is `flow.max_gate_evaluations` (default 10, range 2 to 100, applied at daemon start).
A gate whose `maxRetries` is above the ceiling is rejected before the run starts. A lower ceiling than the
YAML limit of 10 adds a runtime bound. Reaching the ceiling fails the run with `gate_evaluation_limit`.

```toml config
max_flow_retry_cost_usd = 2.5

[system]
log_level = "info"

[flow]
max_gate_evaluations = 5
namespace_prompt_max_bytes = 8192
```

`max_flow_retry_cost_usd` is a cumulative cost budget, checked before every loop iteration.
A positive value denies the next iteration once the flow's measured spend reaches it, with `flow_retry_budget_exceeded`.
The check fails closed with `flow_retry_budget_unavailable` when no database or trace id is available,
when the usage query fails, or when a call has no known price. Omit the key or set it to `0` to disable the budget.

The loop body is every step on a dependency path from `backTo` to the gate. A body step must be an `agent` step.
It may use `strategy: react` or `strategy: mcp`, or a `dynamic` mode without a strategy. These are not allowed:
`cli_delegate`, nested gates, branches, voting or delegate cycles, `onError`, `retry.maxAttempts` above 1
(the gate is the only retry owner), and namespace `append` writes (append writes are not allowed in a loop body).
A `react` step in the body may write files, and each iteration writes again. This is intentional.
Steps that consume loop output must depend on the gate. A step that depends on a body step but not on the gate is rejected.
Body failure, skip or a persistence failure ends the run with `gate_loop_body_failed` or `gate_loop_body_skipped`.
Running a retrying gate outside `FlowRunner` fails with `gate_retry_requires_runner`.

```yaml flow
id: self-correcting-example
name: Self-correcting example
description: A gate loops back to the implementation once.
steps:
  - id: implement
    name: Implement the change
    agent_role: senior-coder
    strategy: react
    dependsOn: []
    input: { source: request, transform: passthrough }
  - id: quality-gate
    name: Judge the implementation
    type: gate
    agent_role: quality-judge
    dependsOn: [implement]
    input: { source: step, stepId: implement, transform: passthrough }
    evaluate:
      agent_role: quality-judge
      criteria: [code_correctness, has_tests]
      threshold: 0.8
      onFail: retry
      maxRetries: 2
    loop:
      backTo: implement
  - id: report
    name: Report the accepted change
    agent_role: technical-writer
    dependsOn: [quality-gate]
    input: { source: aggregate, from: [implement, quality-gate], transform: passthrough }
output:
  from: report
  format: markdown
```

**Checkpoints and resume.** The daemon saves consumed evaluations and loop phases before each call.
A settled state that matches the current flow, request, limits and bindings resumes inside the original cap.
An interrupted body or judge call, a changed identity, or a checkpoint from before this contract
fails with `flow_control_resume_unsupported` before any model call.

**Branch routing.** A `branch` step runs its agent and routes on the agent's output.
The output must be JSON, optionally inside one code fence. Invalid JSON is repaired when possible.
The parsed value is available to conditions as `results.<step-id>.data`.
Conditions in `branches` run in order. The first match wins, then `default`, and no match fails the run.
A branch never falls back to `default` when its output cannot be parsed.
Every target must directly depend on the branch.
The agent-only fields `strategy`, `effort` and `thinking` are rejected on a branch step, as are `condition`,
`onError`, a non-declared `execution_mode` and `retry.maxAttempts` above 1.
Bind a stronger model through `binding` or an overlay instead. A branch step accepts `binding` and `pin`.

| Failure code                | Cause                                               |
| --------------------------- | --------------------------------------------------- |
| `branch_output_unparseable` | The branch output is not JSON, even after repair.   |
| `branch_condition_error`    | A condition raised an evaluation error.             |
| `branch_no_match`           | No condition matched and the step has no `default`. |

Targets that the branch does not take are skipped with the code `branch_not_taken`.
Steps reachable only through a skipped target are skipped with the same code.
A join step runs when at least one dependency ran and reads only those results.
A step skipped by its own `condition` carries the code `condition` instead. Its dependents keep running.

```yaml flow
id: triage-example
name: Triage example
description: A branch runs only the matching pipeline.
steps:
  - id: triage
    name: Classify the request
    type: branch
    agent_role: code-analyst
    dependsOn: []
    input: { source: request, transform: passthrough }
    branches:
      - condition: "results.triage.data.category === 'bug'"
        goto: bug-fix
    default: feature-design
  - id: bug-fix
    name: Plan the bug fix
    agent_role: senior-coder
    dependsOn: [triage]
    input: { source: step, stepId: triage, transform: appendToRequest }
  - id: feature-design
    name: Design the feature
    agent_role: software-architect
    dependsOn: [triage]
    input: { source: step, stepId: triage, transform: appendToRequest }
  - id: summary
    name: Summarize the selected pipeline
    agent_role: technical-writer
    dependsOn: [bug-fix, feature-design]
    input: { source: aggregate, from: [bug-fix, feature-design], transform: appendToRequest }
output:
  from: summary
  format: markdown
```

**Shared namespace.** `namespace.enabled` is off by default. When a flow enables it, the evidence that earlier
steps wrote is appended to a later step's prompt as a block labeled "untrusted data". The block is bounded by
`flow.namespace_prompt_max_bytes` (default 16384, range 1024 to 65536).

**Capability requirements.** `requires_capabilities` lists capabilities the flow needs. The supported value is
`[voting]`, which needs the Team edition. A run in an edition without the capability fails with `capability_unavailable`
before any step runs. `exactl flow list` marks each flow (see Flow Commands below).

```yaml flow
id: voting-example
name: Voting example
description: A flow that needs the Team voting capability.
requires_capabilities: [voting]
steps:
  - id: vote
    name: Choose an architecture
    type: voting_group
    agent_role: software-architect
    dependsOn: []
    input: { source: request, transform: passthrough }
    voting:
      runners:
        - blueprint: software-architect
        - blueprint: software-architect
        - blueprint: software-architect
      strategy: majority
      halt_on_no_consensus: true
      timeout_ms: 60000
output:
  from: vote
  format: markdown
```

**Failure codes.** `gate_halted`, `gate_evaluation_limit`, `gate_loop_body_failed`, `gate_loop_body_skipped`,
`gate_retry_requires_runner`, `flow_retry_budget_exceeded`, `flow_retry_budget_unavailable`,
`flow_control_resume_unsupported`, `branch_output_unparseable`, `branch_condition_error`, `branch_no_match`
and `capability_unavailable` all end the run. None of them is retried by a generic step retry.

**Shipped blueprints.** Each blueprint lives in `Blueprints/Flows/` and ships a companion overlay.
A blueprint marks step weight with `effort` and `thinking` and never hard-codes a service, so it runs on any
configured provider. Pass an overlay with `exactl request create --flow <id> --overlay <file>` to bind strong and light
steps to concrete services. The files below are TOML. `--overlay` reads them directly, and the daemon overlay
directory accepts them too.

| Blueprint                        | Shape                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `self-correcting-implementation` | plan, implement, test, then a gate that loops back to `implement` once                  |
| `triage-router`                  | a branch picks bug, feature, docs or security and only that pipeline runs               |
| `parallel-research`              | three explorers share findings through the namespace, then compose and a warning gate   |
| `guarded-change`                 | read-only explore, a reviewed delegate cycle, a security gate that halts, then validate |
| `architecture-decision`          | context, a majority vote, then an ADR; needs `requires_capabilities: [voting]` (Team)   |

Data edges: in `self-correcting-implementation`, `quality-gate` reads `implement` and `write-tests`, and `report` reads
`implement`, `write-tests` and `quality-gate`. In `triage-router`, each pipeline reads `triage`, and `summary` joins the four
pipeline ends. In `parallel-research`, explorers write `findings.code`, `findings.docs` and `findings.tests`, `compose`
reads them, and `evidence-gate` reads `compose`. In `guarded-change`, `implement` reads `explore`, `security-gate` reads
`explore` and `implement`, and `validate` reads `implement` and `security-gate`. In `architecture-decision`, `vote` reads
`context` and `adr` reads `vote`.

`guarded-change` has these prerequisites. The request names a portal and a hardened portal-relative
`plan_context_ref`. The portal uses worktree execution. The config enables `[session_delegate]` with the
`code_changes` gate, headless launch, `harden_permissions = true` and `permitted_paths` for the files the plan may change.
Without them the delegate cycle step fails the flow. A failing security gate halts the run, `validate` never starts,
and the governed worktree stays available for inspection. The flow promises no compensation and no automatic merge.

**Companion overlays.** Each shipped blueprint has an overlay that binds its steps to services:

- `configs/bindings/flows/self-correcting-implementation.example.toml`
- `configs/bindings/flows/triage-router.example.toml`
- `configs/bindings/flows/parallel-research.example.toml`
- `configs/bindings/flows/guarded-change.example.toml`
- `configs/bindings/flows/architecture-decision.example.toml`

Overlay entries name services from the operator's catalog. See
[Model bindings for flow steps](../Model_Settings.md#model-bindings-for-flow-steps) for catalog setup.

## Condition Expressions

Flow conditions use a safe expression syntax:

```yaml
# Simple comparisons
condition: "status == 'success'"
condition: "confidence >= 80"

# Logical operators
condition: "status == 'success' && score >= 70"
condition: "isComplete || hasTimeout"

# Step result access
condition: "steps.validation.passed == true"
condition: "steps.analysis.score >= threshold"
```

## Quality Gates

Gates enforce quality standards before proceeding. A `gate` step sets its judge, criteria and failure
policy in `evaluate`. See [Advanced Flow Controls](#advanced-flow-controls) for `onFail`, retry loops and failure codes.

**Built-in Evaluation Criteria:**

| Criteria                     | Description                           |
| ---------------------------- | ------------------------------------- |
| `code_correctness`           | Validates syntax and semantics        |
| `has_tests`                  | Ensures test coverage exists          |
| `follows_conventions`        | Matches project conventions           |
| `no_security_issues`         | Checks security best practices        |
| `performance_considerations` | Validates performance characteristics |

## Feedback Loops

Feedback loops are gate retry loops: a gate with `onFail: retry` and `loop.backTo` re-runs the steps
from `backTo` to the gate. See [Advanced Flow Controls](#advanced-flow-controls).

## Voting Group Steps

`voting_group` steps run multiple agents on the same objective and resolve
consensus. This is a **Team/Enterprise** feature (Solo ❌ / Team ✅ / Enterprise ✅).

```yaml
step:
  id: "vote-on-result"
  type: "voting_group"
  agent_role: "voter"
  voting:
    runners:
      - blueprint: "senior-coder"
        prompt_variant: "Focus on correctness"
      - blueprint: "senior-coder"
        prompt_variant: "Focus on performance"
      - blueprint: "senior-coder"
        prompt_variant: "Focus on maintainability"
    strategy: "majority" # majority | weighted | llm-judge
    halt_on_no_consensus: true # true: halt via Plan Amendment
    timeout_ms: 30000
```

**Strategies:**

- `majority` — Most frequent response wins (deterministic, CI-safe)
- `weighted` — Highest `confidence` score wins (deterministic, CI-safe)
- `llm-judge` — Judge blueprint ranks candidates (non-deterministic, provider-live)

When `halt_on_no_consensus: true` and no consensus is reached, execution halts
via the Plan Amendment gate for operator resolution. When `false`, the best
candidate is returned with a `dissent_summary`.

Fan-out cost is attributed per runner through `ICostTracker`. Each runner
execution is logged as a separate `voting.runner_failed` or `voting.resolved`
event.

**Edition note:** Runtime edition-gating is deferred to a future
edition-enforcement phase. The `voting_group` construct is reachable in Team
builds but must not be advertised as a generally available Solo feature until
edition-enforcement ships.
