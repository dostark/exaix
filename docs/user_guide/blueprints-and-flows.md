# Blueprints and Flows

Agent role blueprints, flows, step execution and scaffolding. Part of the [Exaix User Guide](README.md).

## Blueprints

A blueprint defines an agent role: its persona, its capabilities and its system prompt. Blueprints are **required** for request processing. A request that names a role without a blueprint fails.

The `exactl blueprint` commands create, list, show, validate, edit and remove roles. Every option is in the generated [blueprint reference](../cli/blueprint.md).

Tips:

- Start from an existing role. `exactl blueprint create <agent-id> --name "<Name>" --from <existing-role>` seeds the model, the capabilities and the prompt body of the new role from the prototype.
- Run `exactl blueprint validate <agent-id>` after each hand edit. `exactl blueprint edit <agent-id>` opens the file in `$EDITOR`.
- `exactl blueprint remove` asks for confirmation. Pass `--yes` in scripts.

## Blueprint file structure

> **model resolution and intent:** Hardcoded `model:` in blueprints is deprecated. Use `model_size:` + `characteristics:` instead.
> See [Model Intent](agent-features.md#model-intent-model-resolution-and-intent) for the replacement system.

```markdown
---
agent_role: "senior-coder"
name: "Senior Coder"
model: "anthropic:claude-3-sonnet"
capabilities: ["code_generation", "debugging"]
output_contract: plan
default_skills: ["code-review", "portal-grounding"]
created: "2025-12-02T10:00:00Z"
created_by: "user@example.com"
version: "1.0.0"
---

# Senior Coder Agent

System prompt with <thought> and <content> tags...
```

## Flows

A flow coordinates several agents to do a complex task. The `exactl flow` commands list flows, show a flow with its dependency graph, validate a definition and run a flow. `exactl flow run <flow-id> "<goal>"` creates a request for the flow. It does the same as `exactl request create "<goal>" --flow <flow-id>`. Every option is in the generated [flow reference](../cli/flow.md).

`exactl flow bindings <flow-id>` previews the effective model binding of each step and the source of each field. Use it with `--overlay` or `--bind` to check a binding change before a run. See [Model Settings](model-settings.md) for the binding layers.

`exactl flow list` shows a Capabilities column. A flow without `requires_capabilities` shows `None`. A flow whose capabilities your edition includes shows `eligible (runtime unverified)`. A flow that needs a capability your edition lacks shows `unavailable (needs voting)`. The list checks the edition only. The daemon confirms the installed capability when the run starts and fails with `capability_unavailable` if it is missing. `exactl flow list --json` reports `requiresCapabilities`, `tierEligible` and `runtimeAvailability: "unknown"` for each flow.

## Flow Step Execution Strategy

A flow step's YAML may declare an optional `strategy` field that routes the step through
Exaix's agent strategy registry instead of the default single-shot generate path:

```yaml
steps:
  - id: implement-feature
    name: Implement Feature
    agent_role: senior-coder
    execution_mode: declared # strategy is only valid on a declared step
    strategy: cli_delegate # react | mcp | cli_delegate
    dependsOn: [design-architecture]
    input:
      source: step
      stepId: design-architecture
      transform: mergeAsContext
```

**Allowed values:**

| Value          | What it does                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------ |
| _(unset)_      | Default. The step generates once via the daemon's direct-generate path — no live tool access.    |
| `react`        | Runs the daemon's own ReAct loop against the step's portal — the daemon keeps execution control. |
| `mcp`          | Routes through the MCP tool-execution path.                                                      |
| `cli_delegate` | Delegates the step to a headless CLI subprocess (`opencode`/`claude`) running its own session.   |

**DECLARED-only rule:** `strategy` may only be set on a step whose `execution_mode` is
`declared` (the default when `execution_mode` is omitted). Setting it on a `dynamic` step is a
validation error — a dynamic step already selects its own tools at runtime, so a forced
strategy is redundant.

**Choosing a strategy — the control-axis tradeoff:** `react` and `cli_delegate` are not a
"faster vs. slower" choice — they trade off _who_ keeps execution control. `react` keeps the
daemon in the loop (its own context compaction, tool-result formatting, and audit trail apply
uniformly), while `cli_delegate` hands the whole task to the external CLI's own internal loop
(useful when you want that tool's own workflow — e.g. its own test-running or file-editing
conventions — rather than the daemon's). Neither is cheaper by default: measure the actual
prompt tokens, wall-clock time, and cost for your own task rather than assuming one is
always cheaper. Most flow steps need neither — a step that only synthesizes or aggregates
already-provided context does not need live tool access at all, so the default (unset) is the
right choice for most steps; opt a step into `react` or `cli_delegate` only when its task
genuinely needs to read the live repository or produce real file changes.

`feature-development.flow.yaml` ships with `strategy: "cli_delegate"` on all 6 of its steps as
a worked example of this rollout, chosen to match its own direct-execution comparison baseline
(see `exaix-dev-docs/planning/phase-158-artefact-value-evaluation.md`'s `feature-development`
decision).

## Session Delegate Cycle Step Type

`session_delegate_cycle` is a flow step **type**, not a `strategy` value — it selects an
entirely different step handler, so it cannot be combined with `strategy:` on the same step.
Where `strategy: cli_delegate` hands one whole step to a single unsupervised CLI session,
`session_delegate_cycle` decomposes a hardened, multi-step implementation plan into **N**
separate session delegations, run strictly one at a time, each individually reviewed before the
next is allowed to start:

```yaml
steps:
  - id: implement-steps
    name: Implement Steps (TDD)
    type: session_delegate_cycle
    agent_role: dogfood-coder # agent_role threaded to the delegate's hardened launch
    dependsOn: [plan-review]
    input:
      source: request # the request must carry plan_context_ref — no static plan path here
      transform: passthrough
    delegateCycle:
      requireChangedPaths: true # non-empty paths_touched required (currently always true)
      review:
        agent_role: quality-judge # judge agent role that reviews each completed step
        criteria: [code_correctness, has_tests, task_fulfillment]
        threshold: 0.8
        onFail: halt # only halt is accepted for this step type
        maxRetries: 3 # accepted but unused — see Failure semantics below
        includeRequestCriteria: false
```

**Required `[session_delegate]` settings:** the step reuses the same `[session_delegate]` TOML
config documented above for the single-shot handoff (`enabled`, `tool`, `gates` must include
`code_changes`, `launch_mode`, `permitted_paths`); there is no separate cycle-specific config
block. A misconfigured or disabled `[session_delegate]` fails the flow at the cycle step, and
never silently falls back to autonomous (non-delegated) execution.

**Provenance:** the plan the cycle executes comes from `plan_context_ref` on the request, set by
`RequestProcessor` — never from the flow YAML or request body text — and resolved strictly
relative to the request's configured portal root. Neither the flow definition nor the request
prose can substitute a different plan or point outside the portal.

**Restart behavior:** the cycle is crash-safe. A SQLite claim (unique per
`parentTraceId`/`parentStepId`/`sequence`/`planDigest`) guarantees at most one durable launch per
step even across a daemon restart or duplicate watcher entry; a JSON checkpoint lets a restarted
daemon resume a running cycle, replay an already-completed one with zero relaunches, or reject a
checkpoint whose plan or key no longer matches (rather than silently overwriting it).

**Failure semantics:** any failure — a hollow or rejected delegate return, a failed review, an
oversized/too-long plan, a plan-parse error, or a checkpoint mismatch — halts the cycle before
launching the next step; there is no partial credit and no silent re-plan. The step handler
never implemented retry, so `session_delegate_cycle`'s `review.onFail` accepts only `halt` —
`retry` and `continue-with-warning` fail schema validation rather than silently doing nothing
(`maxRetries` is still accepted, inherited from the shared gate schema, but has no effect). Full
mechanism and journal-event detail: `packages/flow/README.md#session-delegate-cycle`.

**Production example:** `Blueprints/Flows/dogfood-meta-workflow.flow.yaml:next-steps` ships this
configuration in production, replacing an earlier `strategy: cli_delegate` step.

**Bounded context supplement:** when `[dogfood.context] enabled = true`, both this cycle step
and the single-shot `cli_delegate` strategy compose a small, scoped portal-knowledge/memory
supplement onto the objective before each launch, and capture an immutable record of the exact
bytes sent — disabled by default and additive; see the
[Bounded context supplement](../dogfooding.md#67-bounded-context-supplement-dogfoodcontext) in the Dogfooding Guide for
the full contract and its stated limitations. On a supported native client (Claude Code,
OpenCode, and — governed cycle only — Codex), the same launch also gets a private, per-launch
MCP connection so the child can actively query for more context mid-task; see
[Session-bound MCP context queries](../dogfooding.md#68-session-bound-mcp-context-queries) in the Dogfooding Guide.

## Flow Step Execution Modes

A flow step declares how it executes via `execution_mode`:

```yaml
steps:
  - id: explore
    name: Explore the codebase
    agent_role: senior-coder
    execution_mode: dynamic # declared (default) | dynamic
    permitted_tools:
      - read_file
      - list_directory
      - search_files
```

| Mode       | What it does                                                                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `declared` | Default. The step generates once via the agent executor (optionally routed by a `strategy`, above).                                                                                                               |
| `dynamic`  | Model-driven tool selection: the step runs a ReAct loop that reasons about which `permitted_tools` to call next and declares completion — see `Blueprints/Flows/analyze-codebase.flow.yaml` for a worked example. |

`execution_mode: dynamic` is a **Team-edition** capability. On a Team/Enterprise daemon the
step's `permitted_tools` are enforced at runtime (the model may only call a tool from that
list); on a Solo daemon the step is not dynamically wired and falls back to the declared path.
Use `dynamic` when the step genuinely needs to inspect the live workspace and choose its own
next action (exploration, investigation); use `declared` (with or without a `strategy`) for
steps whose work is already fully specified.

## Scaffolding Agent Roles and Behavioural Patterns

The catalog is a flat set of concrete agent roles with no separate template directory. To create a role, clone an existing one with `exactl blueprint create <agent-id> --name "<Name>" --from <prototype>`. Run `exactl blueprint validate <agent-id>`. Then attach the skills that give the role the behaviour you want and start a request with `exactl request create "<task>" --agent <agent-id>`.

The behavioural patterns that used to be templates are now **skills** in
`Blueprints/Skills/` — add them to your agent role's `default_skills`:

| Pattern                  | Skill                                                  | Best for                   |
| ------------------------ | ------------------------------------------------------ | -------------------------- |
| Self-critique            | `reflexive-critique`                                   | Quality-critical tasks     |
| Multi-turn dialogue      | `conversational-dialogue`                              | Interactive sessions       |
| Multi-agent coordination | `collaborative-flow`                                   | Handoffs and consensus     |
| LLM-as-Judge             | `verdict-rubric`                                       | Quality gates, approvals   |
| Information gathering    | `research-methodology`                                 | Exploration, documentation |
| Domain review            | `code-review`, `architecture-review`, `security-first` | Security, architecture     |

See `Blueprints/Skills/README.md` for the full skill library.

Each agent role's frontmatter also carries a `permitted_tools` allowlist — the
least-privilege ceiling on which MCP tools that agent role may ever use,
regardless of which skills get matched onto a request. See
[Skill Tools](skills.md#skill-tools) for how a matched skill's own `tools:`
declaration narrows within that ceiling.
