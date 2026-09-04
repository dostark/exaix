---
agent: general
scope: dev
title: "Exaix Developer Glossary"
short_summary: "Implementation-level glossary: journal field maps, code identifiers, naming conventions, and code-identifier tables."
version: "1.0"
topics: ["glossary", "implementation", "code-identifiers", "naming-conventions"]
---

# Exaix Developer Glossary

Single source of truth for **kernel** and other critical names used in Exaix,
at the implementation level: code identifiers, journal payload fields, CLI
surface, and naming conventions that keep code, journal records, and schemas
consistent with each other.

> **Why a second glossary?** Exaix splits its terminology across two documents
> by audience. **[`../../GLOSSARY.md`](../../GLOSSARY.md)**, at the repo root, is the
> public, concept-level glossary — plain-language definitions of Agent Role,
> Agent Role Blueprint, Actor, Agent, Tool, Artifact, Trigger, Request, Request
> Frontmatter, Plan, Plan Amendment, Changeset, Review, Blueprint, Flow, Flow
> Step, Gate Evaluate, Wait State, Activity Journal, Trace ID, Portal, Memory,
> Skills, MCP Server, and the Actor/Agent/Agent Role clarifying diagram — written
> for anyone building a mental model of how Exaix works. **This document** is
> its contributor-facing companion: it does not redefine any of those terms —
> it assumes you already have that mental model — and instead adds the
> implementation-level detail a contributor needs to keep code, journal
> payloads, and schemas consistent: which field is named what, in which layer,
> and why.

---

## End‑to‑End Request Flow Diagram

```text
[ External Trigger ]
        |
        v
+---------------------+
|       ACTOR         |
| - user via CLI      |
| - mcp client        |
| - service           |
+---------------------+
        |
        | creates request (frontmatter + body)
        v
+---------------------+   resolve agent role   +-----------------------+
|      REQUEST        | --------------------> |  AGENT ROLE REGISTRY  |
| - frontmatter       |                        | Blueprints/Agents/    |
|   - agent_role      |                        +-----------------------+
+---------------------+                                  |
        |                                                 v
        | dispatch                              +-------------------+
        v                                       |    AGENT ROLE     |
+---------------------+  orchestrate using      | (LLM persona)     |
|       AGENT         | ----------------------> +-------------------+
| - type (flow, tool) |
| - execution logic   |  logs progress and results
+---------------------+ --------+
        |                       v
        | execute steps  +---------------------+
        v                |       JOURNAL       |
+---------------------+  | - actor             |
|  TOOLS / SERVICES   |  | - actor_type        |
| (memory, tools, ..) |  | - runner_id         |
+---------------------+  | - runner_kind       |
                         | - agent_role         |
                         | - request/flow ids   |
                         +---------------------+
```

---

## Request and Flow Field Conventions

### `agent_role` (request frontmatter)

Name or ID of the agent role to use when handling the request. Exaix resolves
this to an agent role blueprint and passes it to the appropriate agent for
execution. See the root glossary's **Request Frontmatter** entry for the
concept-level role this field plays.

### Agent Role Directory (`Blueprints/Agents/`)

Canonical directory where agent role blueprints are stored and resolved.
All agent roles used by flows, requests and tools must live here.

### `agent_role` (flow step)

Required field on a flow step indicating which agent role blueprint to use for
that step. The flow engine selects an appropriate agent to run the given
agent role. See the root glossary's **Flow Step** entry for the concept-level
role this field plays.

---

## Config Path Settings

### `paths.memoryExecution` (two accepted forms)

Names the execution-memory directory, and accepts **two** shapes — an agent
reading a config must not guess which is meant:

- **Composite / root-relative** — `"Memory/Execution"` (the current default).
  Resolved as `<root>/Memory/Execution`.
- **Bare / memory-relative** — `"Execution"` (the pre-Phase-142 default).
  Resolved as `<root>/<paths.memory>/Execution`.

The disambiguation rule is "does the value contain a separator", and it lives in
exactly one place: `packages/core/src/config/paths.ts:resolveMemoryExecutionRoot`.
Never inline it — joining a composite value onto `paths.memory` produces
`Memory/Memory/Execution`.

### `paths.flows` (one rule, one rejected legacy value)

Names the flow-blueprint catalog. Consumers resolve
`join(config.system.root, config.paths.flows)` and never recompose the path from
`paths.blueprints` plus a flows subfolder — the two agree only on a default
workspace.

The value `"Flows"` is **rejected at config load**: it was the pre-Phase-142
default, resolves to a directory the catalog has never shipped in, and produced
`exactl flow list` reporting "No flows found" against a workspace holding twenty
flows. The composite form is `"Blueprints/Flows"`.

---

## CLI Layer

### `exactl`

Primary CLI entrypoint for Exaix operations: creating and sending requests,
managing blueprints and flows, running validations and CI checks.

### `--agent-role` (CLI flag)

CLI option used to select the agent role blueprint for a given request. The CLI
resolves the agent role and delegates execution to the correct agent.

### `exactl blueprint agent-role *`

CLI subcommands for managing agent role blueprints (list, create, validate, show,
delete). These commands operate only on `Blueprints/Agents/`.

---

## MCP Tooling

### `exaix*create*request` (MCP tool)

MCP tool used by clients to create and submit Exaix requests programmatically.
Its input parameter for selecting an agent role is named `agent_role`. See the
root glossary's **MCP Server** entry for the concept-level role MCP plays in Exaix.

---

## Journal and Persistence

### Journal

Append‑only record of Exaix activity, including requests, flow steps, agent
executions and internal events. Used for debugging, auditing and regression
testing.

### Journal Actor Fields (`actor`, `actor_type`)

Fields in journal entries describing **who** performed the action.

| Field        | Type   | Meaning                                                                                                              |
| ------------ | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `actor`      | string | Free-form identifier of who acted. Format: `"user:<email>"`, `"service:<name>"`, `"mcp-client:<id>"`, `"agent:<id>"` |
| `actor_type` | string | Enumerated category of the actor: `"user"`, `"service"`, `"mcp-client"`, `"system"`, `"agent"`                       |

`actor_type = "agent"` means an agent role instance acted autonomously with
no human in the loop (e.g. a chained or scheduled agent-role call).

### Journal Runner Fields (`runner*id`, `runner*kind`)

Fields in journal entries describing **how** the work was done — which Runner
handled it.

| Field         | Type   | Meaning                                                                      |
| ------------- | ------ | ---------------------------------------------------------------------------- |
| `runner_id`   | string | Identifier of the Runner instance, e.g. `"agent-runner"`, `"agent-composer"` |
| `runner_kind` | string | Category of Runner: `"agent-composer"`, `"agent-runner"`, `"request-router"` |

These fields are **always** about the Runner, never about an agent role
blueprint.

### Journal Agent Role Field (`agent_role`)

Field in journal entries describing **what** LLM persona was used.

| Field        | Type   | Meaning                                                                                                                                         |
| ------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_role` | string | Canonical ID of the agent role blueprint that was loaded and run for this LLM call. Matches the slug of the `.md` file in `Blueprints/Agents/`. |

---

## Code Identifiers

This section defines the exact camelCase / snake_case names used in TypeScript
interfaces, database columns and journal payloads for each core concept.

### `agent_role`

| Name         | Where used                                                                               | Meaning                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `agent_role` | Request frontmatter, flow YAML step, CLI flag `--agent-role`, DB column, journal payload | The canonical slug that selects and, once resolved, identifies an agent role blueprint (e.g. `senior-coder`) |

Unlike the retired `identity`/`identity_id` pair, `agent_role` is used
end-to-end as both the user-facing input and the stored value — there is no
separate resolved-identifier field.

### Actor code identifiers

| Code name    | Layer                                        | Meaning                                                                                   |
| ------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `actor`      | TypeScript field, journal payload, DB column | Free-form string identifying who performed the action                                     |
| `actor_type` | TypeScript field, journal payload, DB column | Enumerated category: `"user"` \| `"service"` \| `"mcp-client"` \| `"system"` \| `"agent"` |

### Runner code identifiers

| Code name     | Layer                                        | Meaning                                                                                                  |
| ------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `runner_id`   | TypeScript field, journal payload, DB column | Identifier of the Runner instance that handled execution. Never holds an agent role blueprint reference. |
| `runner_kind` | TypeScript field, journal payload, DB column | Category of Runner: `"agent-composer"` \| `"agent-runner"` \| `"request-router"`                         |

### Agent Role code identifiers

| Code name    | Layer                                        | Meaning                                                       |
| ------------ | -------------------------------------------- | ------------------------------------------------------------- |
| `agent_role` | TypeScript field, journal payload, DB column | Canonical ID of the agent role blueprint used for an LLM call |

### Pipeline artifact code identifiers

Canonical implementation-level names for the four gated-pipeline concepts defined
in the root glossary (Trigger, Plan, Review, Artifact):

| Code name                              | Layer                                                           | Meaning                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ExecutionTriggerEnvelope`             | Zod-inferred type, `packages/core/src/triggers/schemas.ts`      | The canonical, normalized form every trigger source (`cli`, `webhook`, `schedule`, `filesystem`, `internal_event`, `mcp`) is parsed into before policy evaluation and dispatch — carries `triggerId`, `source`, `action`, `idempotencyKey`, `subject`, `payload`, `metadata`, `occurredAt` |
| `ITriggerAdapter<TRawInput>`           | Interface, `packages/core/src/triggers/interfaces.ts`           | Per-source adapter contract: `parse(rawInput) → ExecutionTriggerEnvelope`                                                                                                                                                                                                                  |
| `IPlanMetadata` / `IPlanDetails`       | Interfaces, `packages/core/src/types/plan.ts`                   | Frontmatter-derived plan metadata (`status`, `agent_role`, `request_id`, `approved_by`/`rejected_by`/`reviewed_by` + timestamps) and full markdown content for a plan file in `Workspace/Plans/`                                                                                           |
| `IReviewStatus`                        | Type, `packages/core/src/status/review_status.ts`               | Enumerated review outcome — `PENDING` \| `APPROVED` \| `REJECTED` (aliases of the shared `GeneralStatus` enum)                                                                                                                                                                             |
| `IArtifactRow` / `IArtifactRepository` | Interfaces, `packages/core/src/artifact/artifact_repository.ts` | DB-row shape and CRUD contract for the generic `artifact` table that backs Plans, reviews, and other persisted pipeline records — keyed by `id`, `type`, `status`, `request_id`, `file_path`                                                                                               |

### Changeset and Plan Amendment code identifiers

Canonical implementation-level names for the **Changeset** and **Plan Amendment**
concepts defined in the root glossary:

| Code name                                    | Layer                                                                | Meaning                                                                                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IChangesetResult` / `ChangesetResultSchema` | Zod-inferred type + schema, `packages/schemas/src/agent_composer.ts` | Structured result an agent reports after applying a Plan's changes — `branch`, `commit_sha`, `files_changed`, `description`, `tool_calls`, `execution_time_ms`, `unauthorized_changes`, `usage` |
| `IPlanAmendmentService`                      | Interface, `packages/core/src/types/i_plan_amendment_service.ts`     | `shouldAmend(trigger)` decides whether an amendment is warranted; generates a structural patch proposal against a plan's remaining steps                                                        |
| `IPlanAmendmentGate`                         | Interface, `packages/core/src/types/i_plan_amendment_gate.ts`        | `processAmendment(...)` routes a proposed amendment through human approval and returns a decision; `applyApprovedAmendment(...)` rewrites the plan content once approved                        |

### Wait-state code identifiers

Canonical implementation-level names for the **Wait State** concept defined in
the root glossary:

| Code name                        | Layer                                                            | Meaning                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IWaitState` / `WaitStateSchema` | Zod-inferred type, `packages/flow/src/wait_states/wait_state.ts` | Persisted pause-point record — `waitStateId`, `traceId`, `kind`, `status`, `artifactPath`, `deadlineAt`, `resumeToken`, `requestedBy`/`assignedApprover`, `amendmentOf`, `metadata`   |
| `IWaitStateService`              | Interface, `packages/flow/src/wait_states/wait_state_service.ts` | `create` / `getById` / `getByToken` / `transition` / `listPending` — the contract that turns a human approval gate into a durable, resumable record instead of a session-bound prompt |
| `WaitStateAction`                | Union type, `packages/flow/src/wait_states/wait_state.ts`        | Legal transitions a Wait State can undergo: `"resume"` \| `"approve"` \| `"reject"` \| `"amend"` \| `"expire"` \| `"cancel"`                                                          |

### Journal and Trace ID code identifiers

Canonical implementation-level names for the **Activity Journal** and **Trace ID**
concepts defined in the root glossary:

| Code name              | Layer                                                                       | Meaning                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IActivityRecord`      | Interface, `packages/core/src/types/database.ts`                            | DB-row shape for the `activity` table that backs the Activity Journal — `id`, `trace_id`, `actor`/`actor_type`, `agent_role`, `runner_kind`, `action_type`, `target`, `payload`, token/cost fields, `timestamp` |
| `traceId` / `trace_id` | TypeScript field (camelCase) vs. DB column and journal payload (snake_case) | The Trace ID value carried through every layer — same string, different casing convention depending on whether you're in application code or persisted/serialized form                                          |

### Complete journal record field map

Every `activity` table row and every `ILogEvent` / `IActivity` object carries
fields from all three concepts:

```text
actor        — who initiated            (Actor concept)
actor_type   — category of who          (Actor concept)
runner_id    — which Runner             (Runner concept)
runner_kind  — category of Runner       (Runner concept)
agent_role   — which LLM blueprint      (Agent Role concept)
```

Not every event has all five fields populated. A CLI command with no LLM call
will have `actor` and `runner*id` but an empty `agent_role`.

### `AgentHealth` and `AgentStatus`

These describe the **runtime state** of a running Agent instance, not a static
blueprint. They are correctly named with the `Agent` prefix.

- `AgentHealth` — whether the agent process/connection is currently healthy
- `AgentStatus` — lifecycle state of a running agent (`active`, `inactive`, `error`)

These names are **not changed**.

---

## Anomaly Surfacing

### Anomaly

A record in the Activity Journal whose event type is classified as
anomaly-relevant (`DomainEventType`). Anomalies are never detected or
written by a separate subsystem — they are a **read-time projection** over
events the system already emits during execution (tool failures, security
violations, step failures, etc.). See `DomainEventType` in
[domain_event_types.ts](packages/core/src/events/domain_event_types.ts) for
the complete taxonomy.

### Severity

The classification of an anomaly into one of three ordinal levels:

| Severity   | Meaning                                                     | Example Events                                                              |
| ---------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| **high**   | Security violations, permission denials, execution failures | `SecurityViolation`, `ExecutionFailed`, `McpPermissionDenied`               |
| **medium** | Tool call failures, validation failures, git audit failures | `McpToolFailed`, `ExecutionActionFailed`, `LlmCallFailed`, `GitAuditFailed` |
| **low**    | Timeouts, compaction events                                 | `GitAuditTimeout`, `ExecutionContextCompacted`                              |

The mapping from event type to severity is defined in the
`ANOMALY_EVENT_SEVERITY` constant in
[anomaly_classification.ts](packages/core/src/events/anomaly_classification.ts).

### Recovered Failure

A failure anomaly (e.g. `ExecutionActionFailed`, `McpToolFailed`) whose
target later recorded the matching success event (`ExecutionActionCompleted`,
`McpToolExecuted`) within the same trace. Recovered failures are **excluded
from the high/medium/low counts** and counted separately as `recovered`.
The badge hides recovered-only traces: only actionable (unrecovered) signal
is displayed at the list level. Recovery uses exact string matching on the
event `target` field and is defined by the `RECOVERY_PAIRINGS` constant in
[anomaly_classification.ts](packages/core/src/events/anomaly_classification.ts).

### Anomaly Badge

Shown by `exactl review list` when a review's trace has live anomalies
(high + medium + low > 0). Format:

```text
⚠️ N anomalies (X high, Y medium, Z low)
```

Appends `(+N recovered)` when recovered > 0 and the badge is shown.

### Anomaly Section

Shown by `exactl review show` beneath the diff and commit history. Lists
each finding with severity, target, and event type. Recovered findings are
annotated with `recovered: true`.

### `classifyTraceAnomalies`

Pure function in `packages/core/src/events/anomaly_classification.ts` that
takes `IActivityRecord[]` and returns `AnomalyFinding[]`. Iterates
activity event types against the `ANOMALY_EVENT_SEVERITY` map and applies
the recovery rule.

### `summarizeAnomalies`

Pure function that aggregates an `AnomalyFinding[]` into an
`AnomalySummary` with counts for `high`, `medium`, `low`, and `recovered`.
Recovered findings contribute only to the `recovered` count.

### `loadAnomalyPayload`

Private method on the `ReviewCommands` class (`apps/exactl/src/commands/
review_commands.ts`) that loads activities from the database for a given
trace, classifies them, and returns the anomaly findings and summary.
Used by the `show()` and DB-backed list paths.

## Directories and Constants

### `Blueprints/Agents/`

Directory containing all agent role blueprints known to Exaix. Treated as the
single source of truth for agent roles.

### `Blueprints/Flows/`

Directory containing flow blueprints. Each flow step references agent roles by
`agent_role` name.

## Model Registry (Solo Phase 134 + Team Phase 135)

### Floor

The Solo edition's model registry: a static, no-network catalog of provider/model
capabilities and pricing (`DefaultModelRegistry`). It is the baseline the resolver
consults when no live catalog (a Team+ capability) is attached. "Floor" because it is
the minimum guaranteed knowledge — always present, never fetched.

### Provenance

The trust label on a model's pricing: `static` (a known, dated price shipped with the
floor) or `unknown` (no price on record). An `unknown`-priced model is never treated as
"cheapest"; only a genuinely known price can win a cost comparison.

### Curated list

A user-defined, per-size ordered list of preferred providers
(`model_presets.<SIZE>.candidates`). The resolver tries it before any scoring; the first
healthy, registered provider wins and the resolution is journalled with
`reason: preferred_list`. An optional `characteristics` sub-map reorders the list for a
given `--characteristic` (e.g. `cheapest`).

### Cost exemption

The rule that a genuinely local or free provider (Ollama, or any provider whose endpoint
cost is truly $0 by explicit cost tier) bypasses budget filtering and scores as $0 for
`cheapest`. It never applies to `unknown`-priced providers, so a paid provider cannot be
misclassified as free.

### Edition seam

The attach point (`IModelRegistryProvider`, on `IEditionComposer`) by which a Team+
module supplies a live model registry. Solo returns none, so the resolver falls back to
the [Floor](#floor); behaviour is byte-identical whether or not a Team module is present.
Phase 135 registers the concrete Team implementation (`ModelRegistryService`) behind
this seam.

### Admission

The Team live registry's filter over a provider's fetched catalog (§5.9): only a
`curated`, `native` (first-party provider kept whole), `explicit_use` (previously named
by an explicit `provider:model` choice), or `benchmark_topn` (top-N of a tracked
benchmark) model is admitted and persisted — a full vendor catalog is never blindly
ingested. Each admission/retirement is journalled with its reason.

### Route policy

The Team live registry's decision rule (`cheapest` / `reliability` / `native_first` /
`user_order`) for which provider serves a model offered by 2+ providers (e.g. a
first-party API and a marketplace reseller like OpenRouter). A model with exactly one
route short-circuits with `route_reason: single_route` and no routing event.

### Benchmark provenance

The trust label on a Team-ingested benchmark score: which tracked benchmark
(`swe_bench_verified`, `swe_bench_pro`, `gpqa`, etc.) produced it, and when it was last
verified. Feeds the `best` characteristic's ranking and the `benchmark_topn` admission
path; a model with no score for any relevant benchmark is skipped for `best`, not
penalized to zero.

### Task-type derivation

The precedence chain (`deriveTaskType`, Phase 135 Step 8) that resolves a request's
`TaskType` for the Team `best` scorer's benchmark lookup: request frontmatter beats
agent role blueprint declaration beats the highest-confidence matched skill's trigger
beats a static entity-name soft-match beats the request analyzer's inferred intent. An
entity's own declaration is never silently overridden by the static map.

### Cost source

The provenance label on a `provider_costs` record: `provider_reported` (the provider
itself reported a real cost, trusted verbatim), `registry_computed` (Team only — no
reported cost, but the live registry has a price for the exact resolved `provider:model`,
computed from real token counts), or a null legacy blended estimate (neither source
available). A reported-vs-computed divergence beyond tolerance emits
`model.cost.divergence`.

### Usage tiebreak

An opt-in Team setting (`model_registry.usage_tiebreak`) that breaks a no-characteristics
resolution tie by the candidate pool's usage history (most/least frequently used)
instead of an arbitrary pick, journalled with `reason: usage_ranked`. Off by default.

## Canonical Prompt (Short)

"Use the Exaix Developer Glossary as the single source of truth for kernel names, journal field maps, and code identifiers."

## Examples

- Example prompt: "Look up `agent_role` in the glossary to verify the journal field name."
