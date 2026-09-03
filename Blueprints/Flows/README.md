# Exaix Flows

This directory contains **flow definitions** for multi-agent orchestration. A flow
is a YAML file (`*.flow.yaml`) that wires together identity steps with
dependencies, inputs, and an aggregated output.

## Catalog model

The catalog is a **flat set of concrete flows** (`*.flow.yaml` in this directory)
plus a small **pattern-template library** under `templates/`. There is no separate
`examples/` tier — example flows that duplicated concretes were retired in Phase
131 (one distinct flow, API documentation, was promoted to a concrete flow).

- `*.flow.yaml` — **concrete, runnable flows** that reference real identities.
- `templates/*.flow.template.yaml` — **abstract structural patterns** (pipeline,
  fan-out/fan-in, self-correcting) whose agent slots are `{{placeholder}}` tokens
  you fill in when you copy one into a new flow.

Every concrete flow — and every real (non-`{{placeholder}}`) `agent_role:` in a
template — must resolve to an identity under `Blueprints/Identities/`. This is
enforced by `deno task check:blueprint-integrity` (recursive, all flows; `{{…}}`
slots are skipped).

## Flow frontmatter (top-level keys)

```yaml
id: my-flow
name: My Flow
description: What this flow accomplishes.
version: 1.0.0
defaultSkills: # optional — applied to every step
  - code-review
steps:
  - id: analyze
    name: Analyze
    type: agent
    agent_role: code-analyst # must be a real identity (or {{placeholder}} in a template)
    dependsOn: []
    input:
      source: request
      transform: passthrough
  - id: review
    name: Review
    type: agent
    agent_role: quality-judge
    dependsOn: [analyze]
    input:
      source: step
      stepId: analyze
      transform: passthrough
output:
  from: review
  format: markdown
settings:
  maxParallelism: 2
  failFast: false
```

`defaultSkills` apply to all steps; a step may add its own `skills` (step-level
takes priority over flow-level).

## Step execution strategy

A step may add an optional `strategy` field to route it through the agent strategy registry
instead of the default single-shot generate path:

```yaml
steps:
  - id: implement-feature
    name: Implement Feature
    agent_role: senior-coder
    execution_mode: declared # strategy is only valid on a declared step
    strategy: cli_delegate # react | mcp | cli_delegate — omit for the default path
    dependsOn: [design-architecture]
```

`strategy` is valid only on a `declared` step (the default when `execution_mode` is omitted) —
setting it on a `dynamic` step is a schema validation error, since a dynamic step already
selects its own tools at runtime. See `docs/Exaix_User_Guide.md`'s "Flow Step Execution
Strategy" section for the full field documentation and the `react` vs `cli_delegate`
control-axis tradeoff.

### Rollout rubric — should a new step opt in?

Bias toward leaving `strategy` unset; opt a step in only when its task genuinely needs it:

- **Leave unset** when the step's job is pure planning, synthesis, aggregation, or
  documentation-writing over context already provided by an earlier step (`mergeAsContext`/
  `aggregate` input). This is the right choice for most steps — reading the live repo would
  add cost without changing the answer.
- **`strategy: react`** when the step's task genuinely needs to inspect the live repository
  (read/search/explore existing code, verify a claim against real files, or produce output
  precise enough that a passed-along summary isn't enough — e.g. drafting a fix or test that
  must reference real function signatures) but does not need to be handed off to an external
  CLI.
- **`strategy: cli_delegate`** when the step's task is to produce or verify real file changes
  (implement code, write tests, run or fix a build).
- A step already covered by a Phase 158 flow-ablation/flow-swap measurement must get the
  **same** strategy choice across every step of that one flow, so a future re-measurement
  compares orchestration overhead alone, not a mix of strategies within one flow.

`feature-development.flow.yaml` ships `strategy: "cli_delegate"` on all 6 of its steps as a
worked example — required uniformly (not a discretionary rubric outcome for every one of its
steps) to match its own direct-execution comparison arm; see
`exaix-dev-docs/planning/phase-158-artefact-value-evaluation.md`'s `feature-development`
decision (`REVISE` as of 2026-08-05: same measured quality as direct execution, meaningfully
higher token/wall-clock cost) and
`exaix-dev-docs/planning/phase-159-flow-step-execution-strategy.md`'s Step 7 audit table for
the full 17-flow catalog rollout and its per-step rationale.

## Using flows

```bash
exactl flow list            # list available flows
exactl flow show <id>       # show a flow's definition
exactl flow validate <id>   # validate a flow against the schema
exactl request "…" --flow <id>   # run a request through a flow
```

## Creating a new flow

Flows are authored as YAML files in this directory. Start either from a concrete
flow (copy a similar `*.flow.yaml` and edit it) or from a structural template:

```bash
cp templates/pipeline.flow.template.yaml my-new-flow.flow.yaml
# replace each {{placeholder}} agent slot with a real identity id, then:
exactl flow validate my-new-flow
```

When you fill a template's `{{placeholder}}` slots with real identity ids and save
it as a `*.flow.yaml`, the integrity gate will require those identities to exist.

### Contributor rule: value evidence

A new flow must carry either a value-evaluation result (a flow-ablation or flow-swap
delta from the value tier described in
`exaix-dev-docs/planning/phase-158-artefact-value-evaluation.md`) or a stated reason
it cannot be measured yet (e.g. it is not corpus-reachable). A flow with neither is
presence-tested (it loads and produces its files) but never shown to help. A value
decision for a flow whose steps mix execution strategies is confounded — pin every
step of the flow being measured to the same `strategy` as its direct-execution
comparison arm (see "Step execution strategy" above) before recording a decision, so
the delta measures orchestration overhead alone. `feature-development` is the worked
example: `REVISE` as of 2026-08-05, recorded in
`scripts/check_artefact_decision_coverage.ts` with `cleanMeasurement: true`.

## Available flows

Concrete flows include: `code_review`, `feature_development`, `documentation`,
`api_documentation`, `refactoring`, `bug_investigation`, `security_audit`,
`pr_review`, `api_design`, `migration_planning`, `test_generation`,
`onboarding_docs`, `analyze-codebase`, `research_synthesis`, `consensus_review`,
and `dogfood_loop`. Use `exactl flow list` for the authoritative, current set.

## Templates

`templates/` holds reusable **structural patterns**, not runnable flows — their
agent slots are `{{placeholder}}` tokens:

- `pipeline.flow.template.yaml` — linear sequence (step 1 → step 2 → …).
- `fan-out-fan-in.flow.template.yaml` — parallel specialists → a synthesizer.
- `self-correcting.flow.template.yaml` — generate → judge → refine loop.

See `templates/README.md` for the pattern details.
