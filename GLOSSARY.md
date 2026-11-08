---
title: "Exaix Glossary"
description: Concept-level glossary of Exaix terminology for newcomers and operators
agent_priority: high
copilot_knowledge_base: true
version: "1.4"
capabilities: [terminology, system_overview]
topics: ["glossary", "terminology", "concepts", "onboarding"]
short_summary: "Plain-language definitions of the core Exaix concepts — Agent Role, Agent, Tool, Actor, Artifact, Trigger, Request, Plan, Plan Amendment, Changeset, Review, Wait State, Blueprint, Flow, Activity Journal, Trace ID, Portal, Memory, Skills, MCP, and more — for anyone building a mental model of how Exaix works., plus the entities that exactl commands name: Approval, Daemon, Workspace, Provider, Config, Memory sub-entities, Skill lifecycle, and Evaluation."
links:
  - "README.md"
  - "ARCHITECTURE.md"
---

## Exaix Glossary

Plain-language definitions of the concepts you need to read the rest of Exaix's documentation and operate the system. For implementation-level detail — code identifiers, journal field maps, and naming conventions that keep code, journal payloads, and schemas consistent — contributors should consult the [Developer Glossary](.copilot/docs/GLOSSARY.md), this document's contributor-facing companion.

---

## Core Execution Concepts

### Agent Role

A configured LLM persona that Exaix can run to perform work on behalf of a user, service, or flow step. An agent role is defined by an **Agent Role Blueprint** — a markdown file describing its instructions, capabilities, and constraints — and is referenced from requests, flows, and tools by its `agent_role` (for example, `senior-coder`).

### Agent Role Blueprint

The markdown file that defines an agent_role: its metadata, instructions, capabilities, and constraints. Stored under `Blueprints/Agents/` and loaded by Exaix at runtime to configure how an agent role behaves.

### Actor

Any entity that can initiate, receive, or process a request or event in Exaix — an end user, a developer, a running agent-role instance, an internal Exaix service, or an external MCP client. Actors are the **"who"** behind every action, and every Activity Journal entry records which actor was responsible.

### Runner

The code-level execution unit that orchestrates one or more agent roles to complete a task — it owns the control flow (calling agent roles, invoking tools, coordinating services), while the agent roles it runs supply the actual LLM behavior. `AgentRunner`, `AgentComposer`, `FlowRunner`, and `RequestRouter` are examples of Runners.

### Tool

A discrete capability — reading or writing files, running git operations, querying external systems — that an agent invokes on an agent role's behalf to act on the world beyond LLM reasoning. Tools are implemented as handlers under `packages/mcp/server/handlers/` (see [.copilot/docs/TOOLS.md](.copilot/docs/TOOLS.md) for the full agent-accessible index), validated and executed by the `ToolRegistry` within an agent role's permitted capabilities and a portal's security boundaries, and exposed to MCP clients through the MCP Server.

### Model Intent (model resolution and intent)

A description of the model you want — by capability requirements — rather than a hardcoded `provider:model` ID. Model Intent fields include `model_size` (S/M/L/XL), `thinking` (true/false), `effort` (low/medium/high), `characteristics` (cheapest/fastest — soft ranking hints), `required_capabilities` (chat, streaming, vision, tools — hard filters), and `preferred_provider`. The `ModelResolver` translates these fields into a concrete `provider:model` at runtime, decoupling agent roles from any single provider.

### ModelResolver (model resolution and intent)

The service that accepts a `ModelIntent` and returns a concrete `{provider, model, callOptions}` tuple. Resolution follows a strict precedence: explicit `provider:model` override > `model_size` + characteristic scoring > preset default > fallback chain > context-window overflow bump. The ModelResolver is wired into `AgentExecutor`, `FlowRunner`, `LlmClient`, and the CLI (`exactl request create`). Available via CLI flags `--model-size`, `--thinking`, `--effort`, `--characteristic`, and `--preferred-provider`.

### ModelSize

The capability tier labels `S`, `M`, `L`, and `XL`, each mapped to a preset profile in `exa.config.toml` (`[model_presets]`) that specifies `min_context_window`, `max_cost_per_mtok`, and `supports_thinking`. S is for simple, cheap tasks (e.g., formatting); XL is for complex work requiring large context and deep reasoning.

### Capability Tier

Another term for ModelSize: a pre-configured profile that bundles context-window size, cost ceiling, and thinking support into a single label (`S`/`M`/`L`/`XL`). Users express their need by tier; the system picks the concrete model that fits.

### Characteristic (model resolution and intent)

A soft ranking hint (`cheapest` or `fastest`) that scores candidate providers without eliminating any. `cheapest` biases toward lower-cost providers; `fastest` treats all candidates equally (picks the first healthy one). Multiple characteristics accumulate. Available as `--characteristic` CLI flag (repeatable) and as `characteristics` in blueprint frontmatter.

### Required Capabilities (model resolution and intent)

A hard filter that excludes providers lacking **all** listed capabilities. Values include `chat`, `streaming`, `vision`, `tools`, and `multi-model`. Only available in blueprint frontmatter (no CLI flag). See `docs/Exaix_User_Guide.md §6.2` for the per-provider support matrix.

### Provider

The backend that actually serves a model: a cloud API (Anthropic, OpenAI, Google, OpenRouter), a local runtime (Ollama), or a command-line tool that Exaix delegates to (`claude-cli`, `opencode-cli`, `codex-cli`). A concrete model is named `provider:model`. `exactl model use <provider>[:<model>]` sets the default, and Model Intent lets an agent role ask for capabilities instead of naming one.

### Model Registry

The catalog of known provider and model pairs with their context windows, capabilities, and prices per million tokens. Every price shows its source and the date it was verified, and is marked stale when it is older than the configured limit, because Exaix treats a price as something it assumes rather than a fact. `exactl model list` prints it (`--model <author/model>` shows every service that serves one model). The Solo edition ships a built-in catalog, and the Team edition can refresh it live with `exactl model refresh`.

### Model Candidates

A curated, ordered list of preferred providers for one **ModelSize**, set in `model_presets.<SIZE>.candidates`. The ModelResolver tries the list before any scoring, and the first healthy provider wins. `exactl model candidates` edits it.

### Routing Policy

## The rule, written as a YAML file, that decides which provider serves a model that more than one provider offers, such as a first-party API and a reseller. `exactl model route explain` shows the ranking for a request without running it, and `exactl model route validate <file>` checks a policy file.

## Clarifying Diagram: Actor vs Runner vs Agent Role

```text
+---------------------+         +-----------------+         +-------------------+
|       ACTOR         |  uses   |      RUNNER     |  runs   |    AGENT ROLE     |
|---------------------| ------> | (runtime logic) | ----->  | (LLM persona)     |
| - user              |         | - composer      |         | - instructions    |
| - service           |         | - flow engine   |         | - behavior config |
| - mcp client        |         | - router        |         | - tools access    |
+---------------------+         +-----------------+         +-------------------+

Actors are "who", runners are "how", agent roles are "what and with which voice".
```

`Agent Role` (the persona) is distinct from `Runner` (the harness component that runs it) — the two are not interchangeable despite the shared prefix. The Runner's own `RunnerKind` taxonomy (`agent-composer`, `agent-runner`, `request-router`) is a separate, closed set describing **which** Runner acted, not which Agent Role it was acting on behalf of.

As a naming rule going forward: "Agent" names something an LLM model is or does (a persona, a model-driven behavior); execution/dispatch machinery is a Runner, typically named with a `*Runner`/`*Router`/`*Composer` suffix.

---

## Runtime and Workspace

### Workspace

The directory tree that holds everything Exaix reads and writes, for example `~/Exaix`. `Workspace/` holds the Requests and Plans (`Requests/`, `Plans/`, `Active/`, `Archive/`, `Rejected/`, `WaitStates/`), `Blueprints/` holds the Agent Role Blueprints and flows, `Memory/` holds the Memory banks, `Portals/` holds the Portal symlinks, and `.exa/` holds the databases and logs, including `journal.db` and `config.db`. Everything except `.exa/` is plain files you can read and diff.

### Daemon

The background process, started with `exactl daemon start`, that does the unattended work. It watches `Workspace/Requests/` for new Requests and `Workspace/Active/` for approved Plans, runs each Request through analysis, routing, and agent execution, resumes flows, and writes the Activity Journal, so work continues after the terminal that submitted it has closed. `exactl daemon status`, `stop`, `restart`, and `logs` control and inspect it.

### exactl

The command-line interface to Exaix. Every command has the same shape, `exactl <noun> [<sub-noun>] <verb> [<id>…] [flags]`, where the noun is one of the entities in this glossary, for example `exactl plan approve <plan-id>`. The 19 root nouns fall into four groups: work (`request`, `plan`, `review`, `flow`, `approval`), definitions (`blueprint`, `skill`, `portal`, `memory`, `model`), operations (`daemon`, `log`, `git`, `mcp`, `config`, `eval`, `dashboard`), and system (`version`, `migrate`). An older spelling that was removed exits with code 2 and prints the command that replaced it.

### Dashboard

The interactive terminal interface, started with `exactl dashboard`, for watching runs, reviewing Plans, managing Portals, and controlling the Daemon from one screen.

### Worktree

An isolated Git checkout, kept under `.exa/worktrees/<portal>/<trace-id>/`, in which an agent changes code for a Portal that opted into worktree execution, so the Portal's own checkout stays untouched while the agent works. `exactl git worktree list` shows them and `exactl git worktree prune` clears stale ones.

### Workspace Schema Version

The version of the on-disk layout and databases of a Workspace, which must be compatible with the version of the `exactl` binary that opens it. `exactl version` shows both, and `exactl migrate check` reports whether they match.

---

## Work Artifacts and the Gated Pipeline

### Artifact

A discrete, file-based unit of work or output that Exaix persists to disk and tracks through the Activity Journal — Requests, Plans, flow run records, wait-state records, and reports are all artifacts. Unlike session-oriented tools where the conversation _is_ the state, Exaix models every stage of work as an inspectable artifact you can read, diff, version with Git, and audit independently of any running process — this is what the phrase "files-as-API" refers to.

### Trigger

An external or internal signal that starts Exaix processing — a webhook call, a cron schedule, a filesystem event, a CLI invocation, or an internal daemon event. Exaix's trigger adapter layer translates each of these source-specific signals into a canonical envelope before handing it to the request pipeline, so work can originate from outside systems (CI, monitoring, schedules) as naturally as from a human writing a request by hand.

### Request

The top-level unit of work submitted to Exaix — a markdown file with YAML frontmatter, dropped into `Workspace/Requests/` (or submitted via the CLI, MCP, or a Trigger). Exaix picks it up asynchronously, routes it to the right agent role, and processes it through the gated pipeline: file → plan → approve → execute → review → merge. `exactl request create` submits one, `exactl request watch` follows it, and `exactl request cancel` stops it while it is still pending or waiting for clarification.

### Request Frontmatter

The YAML metadata block at the top of a request file that configures how Exaix should process it — including which `agent_role` to use, an optional `flow_id`, and execution options. Validated against a schema before processing begins.

### Clarification

The question-and-answer loop that the Quality Gate starts when a Request is too vague to run. The Request enters `refining` or `needs_clarification`, Exaix asks three to five targeted questions, and the answers are folded into a refined specification that guides the agent. `exactl request clarify <id>` answers the questions, `--proceed` runs the best-effort Request as it is, and `--cancel` abandons the clarification. A pending clarification appears in **Approval**.

### Acceptance Criteria

The statements in a Request that define what "done" means, given with `--acceptance-criteria` (repeatable) and `--expected-outcome`. They raise the analyzer's confidence about what success looks like, reach the evaluation steps downstream, and reduce clarification rounds.

### Plan

An agent-generated proposal — written to `Workspace/Plans/` — describing the steps and file changes the agent intends to make in order to satisfy a Request. A human reviews and approves, rejects, or amends the plan before Exaix executes a single step; this is the approval gate that turns autonomous execution into something a human can trust to run unattended.

### Plan Amendment

A structural revision to an in-flight Plan — proposed when a step fails, new information surfaces, or some other trigger fires mid-execution — that is routed back through human approval before the agent resumes. A Plan Amendment lets Exaix replan without ever stepping outside the gated pipeline: a changed intention gets the same scrutiny as the original one. `exactl plan amendment list`, `show`, `approve`, and `reject` handle them.

### Changeset

The actual file modifications an agent produces while executing an approved Plan, captured as a Git branch, a commit, and a structured description of what changed and why. Where a Plan describes what the agent _intends_ to do, a Changeset is the record of what it _actually did_ — the artifact a human inspects during Review before deciding whether to merge it. `exactl git branch list` and `exactl git log` (which searches commits by Trace ID) inspect it from the Git side.

### Review

The human-in-the-loop gate that closes out execution: once an agent finishes producing a Changeset from an approved Plan, a human reviews the resulting diff and either merges it or sends it back for revision. Review is the last link in the chain the README describes as "file → plan → approve → execute → review → merge," the point where a human, not the agent, decides whether the work is actually done. A Review covers code changes (approving merges the branch) and non-code artifacts (approving marks them approved); `exactl review` handles both.

### Blueprint

A configuration file that defines reusable behavior for Exaix — agent roles, flows, tools, and other structured definitions. Agent role blueprints live under `Blueprints/Agents/`; flow blueprints live under `Blueprints/Flows/`. `exactl blueprint` lists, shows, creates, validates, edits, removes, and deprecates the agent role blueprints.

### Flow

A declarative, multi-step process that Exaix executes — typically using one or more agents that in turn run agent roles and tools, optionally sharing intermediate state through a namespace-scoped blackboard. Flows are authored once as YAML and executed by Exaix's reasoning engine, which selects tools, branches, and recovers based on what it observes at runtime. `exactl flow list` shows the available flows and `exactl flow run <flow-id> "<description>"` starts a Request through one.

### Flow Step

A single unit of work within a flow, mapped to a specific agent role. Each step has an `id`, a `name`, the `agent_role` it should run, its dependencies on other steps, and any step-specific configuration.

### Gate Evaluate

A flow block that performs a quality or acceptance check using a "judge" agent role against a list of criteria — the mechanism flows use to validate their own output before proceeding.

### Wait State

The durable, resumable pause point that Exaix writes to disk when a run has to wait for a person — for example a request that needs clarification, or a session delegation gate. A Wait State carries a deadline and a resume token, so the run can sit untouched for hours or days and pick back up exactly where it left off the moment someone acts, or expire safely if no one does. Plan approval, Plan Amendment approval, and Review are separate gates that live in their own plan and review records, and a failing Gate Evaluate halts the run instead of waiting. Every one of them shows up together in **Approval**.

### Approval

Exaix's single view of everything that waits for a person. `exactl approval list` merges eight kinds into one list: a Plan, a Plan Amendment, a Review, a Clarification, a Memory Proposal, a Skill Draft, a Wait State, and a Tool Confirmation. Each row names the exact command that decides it, such as `exactl plan approve <id>`. `exactl approval` itself decides Wait States and Tool Confirmations with typed ids (`wait:<resume-token>`, `tool:<id>`), and every other kind is decided through its own noun.

### Tool Confirmation

A held request for a person to allow a tool call that needs approval, for example writing outside the Workspace or a dangerous configuration change. It is stored as pending with an expiry, and `exactl approval approve tool:<id>` or `reject tool:<id>` decides it. It takes exactly one decision, and an expired confirmation counts as a denial. Each decision is written to the Activity Journal as `tool_confirmation.decided`.

---

## Observability and Audit

### Activity Journal

Exaix's permanent, append-only audit trail: a typed, trace-linked record of every significant action the system takes — who initiated it, which Agent and Agent Role carried it out, what it touched, and when. Every Request, Plan, Changeset, Review, and Wait State transition is logged here, which is what makes an Exaix run independently inspectable after the fact — you don't have to have watched it live to trust what happened. `exactl log list` queries it, `log wait` blocks until an event appears, `log verify` checks its hash chain for tampering, and `log cost` reports what the runs cost.

### Trace ID

A unique identifier that threads every event belonging to one unit of work — a Request's Trigger, its Plan, each execution step, its Review, and the final commit — into a single followable chain through the Activity Journal. Pass a Trace ID to `exactl request watch --trace <trace_id>` to stream a run's progress live, or look it up later to replay its full history end to end.

---

## Context and Knowledge

### Portal

Symlink-based access to an external project repository, tracked by a context card and analyzed under Exaix's sandboxed permission model. Portals let agents read and reason about code that lives outside the Exaix workspace — for example, the codebase a request is asking them to change — without granting them broader filesystem access than that single project.

### Portal Knowledge

The structured analysis of a Portal's codebase — directory census, key files, dependencies, code conventions, layers, and exported symbols — stored in `Memory/Projects/<alias>/knowledge.json`. It gives agents project context without reading every file on each Request. `exactl portal knowledge analyze <alias>` refreshes it (`--mode standard` or `deep`), and `exactl portal knowledge show <alias>` displays it.

### Memory

Exaix's persistent, file-backed knowledge store. It retains project context, execution history, and cross-project learnings across runs — the Project, Execution, and Global banks, plus Skills — so agents build on what they learned last time instead of starting from a blank slate on every request.

### Project Memory

What Exaix has learned about one Portal, kept in `Memory/Projects/<alias>/` as an overview, patterns, decisions, and references. `exactl memory project list` and `show` read it.

### Execution Memory

The record of one agent run, kept in `Memory/Execution/<trace-id>/` as a summary, the context used, and the diff it produced. `exactl memory execution list` and `show` read it.

### Learning

A reusable lesson extracted from runs and kept across projects in `Memory/Global/`. `exactl memory learning remove` retires one by marking it deleted while keeping it for audit.

### Memory Proposal

A candidate memory update that waits in `Memory/Pending/` until it is approved by a person or by the opt-in auto-approval rules; nothing enters the Memory banks without that review. `exactl memory proposal list`, `show`, `approve`, and `reject` manage them.

### Memory Index

The generated search indices of the Memory banks — files, patterns, tags, and embeddings — that make retrieval fast. They can be rebuilt at any time with `exactl memory index rebuild`.

### Skills

Reusable procedural knowledge — "how-to" guidance for recurring tasks such as writing tests for a particular codebase or resolving a familiar class of merge conflict. Skills are matched against an incoming request and injected into the agent role's prompt, letting it draw on prior experience rather than rediscovering the same approach from scratch each time. A skill is created as a **Skill Draft** and only a person's approval of a specific **Skill Revision** makes it active; `exactl skill` manages the whole cycle.

### Skill Draft

A skill that no one has approved yet. Every skill that the learning system writes, and every skill in the `learned` or `project` roots without a status, starts as a draft, and a draft is never matched or injected into a prompt. `exactl skill create` and `exactl skill derive` write drafts.

### Skill Revision

One exact version of a skill, identified by a hash of its files, so every edit makes a new revision. Approval is bound to the revision that was reviewed: `exactl skill approve <name> --revision <id>` fails if the draft changed after the review. Plans record the revisions they used, and `exactl skill revisions` and `exactl skill usage` show the history.

---

## Configuration

### Config

The settings that control Exaix. Each setting is a registered key with a default, and an override is stored in the Config DB (`.exa/config.db`) with an append-only history. `exactl config get`, `set`, `unset`, `diff`, `history`, and `rollback` read and change it, and a write is validated against the key's registered bounds, while a locked key refuses writes from every surface.

### Config Lock

A guard that stops every surface — CLI, MCP, and Daemon — from writing one config key until it is unlocked, used when a key is compromised. `exactl config lock add`, `remove`, and `list` manage locks.

### Config Blocklist

A list of key patterns that MCP agents may never write, for one agent role or for all of them. `exactl config block add`, `remove`, and `list` manage it.

### Config Profile

A named group of config overrides that you can switch between, such as a `workstation` profile. `exactl config profile use <name>` activates one and `exactl config profile list` shows them.

---

## Evaluation

### Evaluation Scenario

A scripted run, written as a YAML file, that drives Exaix through a task and scores the result with criteria. Scenarios measure agent behaviour quantitatively so that scores can be tracked over time and used to gate CI.

### Scenario Pack

A named group of Evaluation Scenarios, such as `smoke` or `agent_flows`. `exactl eval run --pack <name>` runs one, `exactl eval history` lists past runs, `exactl eval compare` compares two runs, and `exactl eval report` renders a comparison report across runs.

### Judge Calibration

The check of how closely an LLM judge agrees with a reference, so that its scores can be trusted. `exactl eval calibration generate` runs real scenarios and captures real judge calls as evidence, and `exactl eval calibration score` scores the agreement.

---

## Integrations

### MCP Server

Exaix's [Model Context Protocol](https://modelcontextprotocol.io/) server, which exposes Exaix's tools and operations to MCP clients under a versioned schema — the mechanism that lets Exaix connect to, and be connected from, the broader agent tooling ecosystem without proprietary lock-in.

### MCP Client

The other direction of the Model Context Protocol: Exaix connecting to an external MCP server. `exactl mcp tool list --server <url>` lists that server's tools and `exactl mcp tool call <tool> --server <url>` calls one, while `exactl mcp serve` starts Exaix itself as an MCP Server.
