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

Every concrete flow — and every real (non-`{{placeholder}}`) `identity:` in a
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
    identity: code-analyst # must be a real identity (or {{placeholder}} in a template)
    dependsOn: []
    input:
      source: request
      transform: passthrough
  - id: review
    name: Review
    type: agent
    identity: quality-judge
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
