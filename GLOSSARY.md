---
title: "Exaix Glossary"
description: Concept-level glossary of Exaix terminology for newcomers and operators
agent_priority: high
copilot_knowledge_base: true
version: "1.2"
capabilities: [terminology, system_overview]
topics: ["glossary", "terminology", "concepts", "onboarding"]
short_summary: "Plain-language definitions of the core Exaix concepts — Identity, Agent, Actor, Artifact, Trigger, Request, Plan, Plan Amendment, Changeset, Review, Wait State, Blueprint, Flow, Activity Journal, Trace ID, Portal, Memory, Skills, MCP, and more — for anyone building a mental model of how Exaix works."
links:
  - "README.md"
  - "ARCHITECTURE.md"
---

## Exaix Glossary

Plain-language definitions of the concepts you need to read the rest of Exaix's documentation and operate the system. For implementation-level detail — code identifiers, journal field maps, and naming conventions that keep code, journal payloads, and schemas consistent — contributors should consult the project's internal developer glossary (not part of this public documentation set).

---

## Core Execution Concepts

### Identity

A configured LLM persona that Exaix can run to perform work on behalf of a user, service, or flow step. An identity is defined by an **Identity Blueprint** — a markdown file describing its instructions, capabilities, and constraints — and is referenced from requests, flows, and tools by its `identity_id` (for example, `senior-coder`).

### Identity Blueprint

The markdown file that defines an identity: its metadata, instructions, capabilities, and constraints. Stored under `Blueprints/Identities/` and loaded by Exaix at runtime to configure how an identity behaves.

### Actor

Any entity that can initiate, receive, or process a request or event in Exaix — an end user, a developer, a running identity instance, an internal Exaix service, or an external MCP client. Actors are the **"who"** behind every action, and every Activity Journal entry records which actor was responsible.

### Agent (Runtime Agent)

The code-level execution unit that orchestrates one or more identities to complete a task — it owns the control flow (calling identities, invoking tools, coordinating services), while the identities it runs supply the actual LLM behavior. `AgentRunner`, `FlowRunner`, and `RequestRouter` are examples of runtime agents.

---

## Clarifying Diagram: Actor vs Agent vs Identity

```text
+---------------------+         +-----------------+         +-------------------+
|       ACTOR         |  uses   |      AGENT      |  runs   |     IDENTITY      |
|---------------------| ------> | (runtime logic) | ----->  | (LLM persona)     |
| - user              |         | - orchestrator  |         | - instructions    |
| - service           |         | - flow engine   |         | - behavior config |
| - mcp client        |         | - router        |         | - tools access    |
+---------------------+         +-----------------+         +-------------------+

Actors are "who", agents are "how", identities are "what and with which voice".
```

---

## Work Artifacts and the Gated Pipeline

### Artifact

A discrete, file-based unit of work or output that Exaix persists to disk and tracks through the Activity Journal — Requests, Plans, flow run records, wait-state records, and reports are all artifacts. Unlike session-oriented tools where the conversation _is_ the state, Exaix models every stage of work as an inspectable artifact you can read, diff, version with Git, and audit independently of any running process — this is what the phrase "files-as-API" refers to.

### Trigger

An external or internal signal that starts Exaix processing — a webhook call, a cron schedule, a filesystem event, a CLI invocation, or an internal daemon event. Exaix's trigger adapter layer translates each of these source-specific signals into a canonical envelope before handing it to the request pipeline, so work can originate from outside systems (CI, monitoring, schedules) as naturally as from a human writing a request by hand.

### Request

The top-level unit of work submitted to Exaix — a markdown file with YAML frontmatter, dropped into `Workspace/Requests/` (or submitted via the CLI, MCP, or a Trigger). Exaix picks it up asynchronously, routes it to the right identity, and processes it through the gated pipeline: file → plan → approve → execute → review → merge.

### Request Frontmatter

The YAML metadata block at the top of a request file that configures how Exaix should process it — including which `identity` to use, an optional `flow_id`, and execution options. Validated against a schema before processing begins.

### Plan

An agent-generated proposal — written to `Workspace/Plans/` — describing the steps and file changes the agent intends to make in order to satisfy a Request. A human reviews and approves, rejects, or amends the plan before Exaix executes a single step; this is the approval gate that turns autonomous execution into something a human can trust to run unattended.

### Plan Amendment

A structural revision to an in-flight Plan — proposed when a step fails, new information surfaces, or some other trigger fires mid-execution — that is routed back through human approval before the agent resumes. A Plan Amendment lets Exaix replan without ever stepping outside the gated pipeline: a changed intention gets the same scrutiny as the original one.

### Changeset

The actual file modifications an agent produces while executing an approved Plan, captured as a Git branch, a commit, and a structured description of what changed and why. Where a Plan describes what the agent _intends_ to do, a Changeset is the record of what it _actually did_ — the artifact a human inspects during Review before deciding whether to merge it.

### Review

The human-in-the-loop gate that closes out execution: once an agent finishes producing a Changeset from an approved Plan, a human reviews the resulting diff and either merges it or sends it back for revision. Review is the last link in the chain the README describes as "file → plan → approve → execute → review → merge," the point where a human, not the agent, decides whether the work is actually done.

### Blueprint

A configuration file that defines reusable behavior for Exaix — identities, flows, tools, and other structured definitions. Identity blueprints live under `Blueprints/Identities/`; flow blueprints live under `Blueprints/Flows/`.

### Flow

A declarative, multi-step process that Exaix executes — typically using one or more agents that in turn run identities and tools, optionally sharing intermediate state through a namespace-scoped blackboard. Flows are authored once as YAML and executed by Exaix's reasoning engine, which selects tools, branches, and recovers based on what it observes at runtime.

### Flow Step

A single unit of work within a flow, mapped to a specific identity. Each step has an `id`, a `name`, the `identity` it should run, its dependencies on other steps, and any step-specific configuration.

### Gate Evaluate

A flow block that performs a quality or acceptance check using a "judge" identity against a list of criteria — the mechanism flows use to validate their own output before proceeding.

### Wait State

The durable, resumable pause point underneath every gate described above — Plan approval, Plan Amendment approval, Review, Gate Evaluate. Whenever Exaix needs a human decision before continuing, it writes a Wait State artifact to disk carrying a deadline and a resume token, so the run can sit untouched for hours or days and pick back up exactly where it left off the moment someone acts — or expire safely if no one does. This is what turns Exaix's approval gates from session-bound prompts into durable, inspectable artifacts in their own right.

---

## Observability and Audit

### Activity Journal

Exaix's permanent, append-only audit trail: a typed, trace-linked record of every significant action the system takes — who initiated it, which Agent and Identity carried it out, what it touched, and when. Every Request, Plan, Changeset, Review, and Wait State transition is logged here, which is what makes an Exaix run independently inspectable after the fact — you don't have to have watched it live to trust what happened.

### Trace ID

A unique identifier that threads every event belonging to one unit of work — a Request's Trigger, its Plan, each execution step, its Review, and the final commit — into a single followable chain through the Activity Journal. Pass a Trace ID to `exactl watch <trace_id>` to stream a run's progress live, or look it up later to replay its full history end to end.

---

## Context and Knowledge

### Portal

Symlink-based access to an external project repository, tracked by a context card and analyzed under Exaix's sandboxed permission model. Portals let agents read and reason about code that lives outside the Exaix workspace — for example, the codebase a request is asking them to change — without granting them broader filesystem access than that single project.

### Memory

Exaix's persistent, file-backed knowledge store. It retains project context, execution history, and cross-project learnings across runs — Local, Execution, Global, and Skills banks — so agents build on what they learned last time instead of starting from a blank slate on every request.

### Skills

Reusable procedural knowledge — "how-to" guidance for recurring tasks such as writing tests for a particular codebase or resolving a familiar class of merge conflict. Skills are matched against an incoming request and injected into the identity's prompt, letting it draw on prior experience rather than rediscovering the same approach from scratch each time.

---

## Integrations

### MCP Server

Exaix's [Model Context Protocol](https://modelcontextprotocol.io/) server, which exposes Exaix's tools and operations to MCP clients under a versioned schema — the mechanism that lets Exaix connect to, and be connected from, the broader agent tooling ecosystem without proprietary lock-in.
