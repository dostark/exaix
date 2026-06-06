---
title: "Exaix Glossary"
description: Concept-level glossary of Exaix terminology for newcomers and operators
agent_priority: high
copilot_knowledge_base: true
version: "1.0"
capabilities: [terminology, system_overview]
topics: ["glossary", "terminology", "concepts", "onboarding"]
short_summary: "Plain-language definitions of the core Exaix concepts — Identity, Agent, Actor, Request, Blueprint, Flow, Portal, Memory, Skills, MCP, and more — for anyone building a mental model of how Exaix works."
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

## Requests, Blueprints, and Flows

### Request

The top-level unit of work submitted to Exaix — a markdown file with YAML frontmatter, dropped into `Workspace/Requests/` (or submitted via the CLI or MCP). Exaix picks it up asynchronously, routes it to the right identity, and processes it through the gated pipeline: file → plan → approve → execute → review → merge.

### Request Frontmatter

The YAML metadata block at the top of a request file that configures how Exaix should process it — including which `identity` to use, an optional `flow_id`, and execution options. Validated against a schema before processing begins.

### Blueprint

A configuration file that defines reusable behavior for Exaix — identities, flows, tools, and other structured definitions. Identity blueprints live under `Blueprints/Identities/`; flow blueprints live under `Blueprints/Flows/`.

### Flow

A declarative, multi-step process that Exaix executes — typically using one or more agents that in turn run identities and tools, optionally sharing intermediate state through a namespace-scoped blackboard. Flows are authored once as YAML and executed by Exaix's reasoning engine, which selects tools, branches, and recovers based on what it observes at runtime.

### Flow Step

A single unit of work within a flow, mapped to a specific identity. Each step has an `id`, a `name`, the `identity` it should run, its dependencies on other steps, and any step-specific configuration.

### Gate Evaluate

A flow block that performs a quality or acceptance check using a "judge" identity against a list of criteria — the mechanism flows use to validate their own output before proceeding.

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
