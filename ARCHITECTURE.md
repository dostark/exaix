---
title: ARCHITECTURE.md
description: Exaix system architecture — component boundaries, dependency invariants, and design rationale
agent_priority: critical
copilot_knowledge_base: true
version: 3.0
capabilities: [architecture_overview, execution_flow, component_boundaries, design_decisions]
links:
  - "packages/request/src/processor.ts:RequestProcessor"
  - "packages/execution/src/agent_runner.ts:AgentRunner"
  - "packages/memory/src/bank/memory_bank.ts:MemoryBankService"
  - "packages/request/tests/request_processor_test.ts"
tools_referenced:
  - write_file: packages/mcp/src/handlers/write_file_tool.ts
  - git_commit: packages/mcp/src/handlers/git_tool.ts
copilot_instructions: .copilot/blueprints/senior-coder.md
---

**Version:** 3.1\
**Date:** June 2, 2026

> **What this document covers:** component boundaries, dependency direction, edition-tiering rationale, and architectural invariants — the "why" that code alone doesn't convey.
> **What this document does NOT cover:** configuration syntax, CLI command trees, score formulas, step-by-step protocols, or schema definitions. Those live in package and app READMEs under `packages/` and `apps/`, with redirects in `docs/dev/`.

---

## Project Overview

Exaix is an **asynchronous, file-based AI agent harness** built with **Deno** and **TypeScript** — conceptually closer to GitHub Actions for AI agents than to a chat or IDE tool. Unlike session-oriented tools (OpenCode, Claude Code, Cursor) where conversation _is_ the state, Exaix models work as discrete, auditable artifacts:

- **Requests** are markdown files in `Workspace/Requests/`
- **Plans** are generated artifacts in `Workspace/Plans/`
- **Execution** produces Git branches for human review
- **Every step** is journaled to SQLite for a permanent audit trail

The pipeline processes work through a gated pipeline (file → plan → approve → execute → review → merge) rather than interactive chat sessions. It is designed for **autonomous, multi-agent orchestration with explicit gates** — plan approval, amendment approval, review/merge — not for interactive back-and-forth. This makes it suitable for CI/CD-like workflows where humans set policies and review outputs rather than steering each conversation turn.

## Edition Model Overview

> **Current Status (May 2026):** The **Solo edition** is fully implemented in this repository. Team and Enterprise editions describe aspirational features (Web UI, PostgreSQL, immudb, SSO/SAML, governance dashboard) that are planned but not yet present in the codebase.

Exaix follows a **three-tier edition model** to serve different organizational needs:

| Edition           | Target Audience                         | Key Differentiation                                             |
| ----------------- | --------------------------------------- | --------------------------------------------------------------- |
| **Solo** 🟢       | Individual developers, OSS contributors | CLI + TUI, SQLite audit, MCP client, local-first                |
| **Team** 🔵       | Small teams, startups, consulting firms | + Web UI, PostgreSQL, MCP server mode, multi-user collaboration |
| **Enterprise** 🟣 | Regulated industries, large enterprises | + Governance dashboard, compliance frameworks, immudb, SSO/SAML |

For the full component availability matrix by edition, see `docs/Reference_Data.md#edition-model--component-availability`.

---

## Composability with Session-Oriented Tools

Exaix is designed to **orchestrate rather than replace** session-oriented agent tools (OpenCode, Claude Code, Cursor). These tools excel at interactive refinement — clarifying intent, iterating on plans, or pair-programming code changes — while Exaix provides the governance, audit trail, and multi-agent orchestration that session tools lack.

The embedding points for session tools are the **pipeline gates** where human judgment adds most value: refinement, plan review, code changes, and review/merge.

Session tools are treated as **external delegates** — launched via a configurable tool call, not embedded in the Exaix process. The launch is configured per request, portal, or blueprint via a `session_delegate` section in TOML config.

### Architectural Invariant

Session tool integration **must not introduce session state into Exaix's core pipeline**. The pipeline remains file-driven and asynchronous. The session tool is a transient external process that reads from and writes to the same file system — it does not change how Exaix models work.

### Handoff Contract (Phase 106)

The integration is realized by the `@exaix/session` package as a strict three-part handoff, so the invariant holds by construction (only files + a typed `return.json` cross back):

1. **Brief** — `SessionDelegateService.prepareBrief` (`packages/session/src/session_delegate_service.ts`) atomically writes `Session/{traceId}/brief.json` (objective, scope globs, token budget, single-use resume token, deadline).
2. **Launch** — a per-tool `ISessionAdapter` from `SessionAdapterRegistry` (`packages/session/src/session_adapter_registry.ts`) builds a hardened launch (bare binary + discrete argv, token-budget env only); supervised spawns strip provider secrets and enforce a binary allowlist (`packages/session/src/supervised_launch.ts`).
3. **Return + Reconcile** — the tool writes a mandatory `Session/{traceId}/return.json`; the daemon's `SessionReturnWatcher` (`apps/daemon/src/session_return_watcher.ts`) invokes `SessionReturnProcessor`/`reconcile` (constant-time token check, two-stage path-scope enforcement, gate/decision legality, non-blocking budget overage), maps the outcome into the existing amendment/review/clarification contracts (`packages/session/src/gate_mappers.ts`), and resumes the gate's durable wait state (`packages/session/src/wait/`).

Delegated output is **untrusted** and still flows through the same quality, critique, and review gates as autonomous output. For the pipeline gate diagram with ASCII art and TOML configuration sample, see `packages/flow/README.md#session-tool-integration`.

---

## Key Design Principles

### 1. **Files as API**

- Request input: Markdown files in `Workspace/Requests`
- Plan output: Markdown files in `Workspace/Plans`
- Configuration: TOML with Zod validation
- Context: File system is source of truth

### 2. **Separation of Concerns**

- **CLI Layer**: Human interface (exactl)
- **Core Layer**: Daemon orchestration (main.ts, watcher)
- **Service Layer**: Business logic (processors, runners)
- **Storage Layer**: Edition-tiered databases + file system

### 3. **Auditability & Governance**

- Every action logged to Activity Journal (tiered by edition)
- Trace ID links: request → plan → review → commit
- Immutable event stream for compliance (🟣 Enterprise: WORM storage)
- Explicit approval gates: plans and reviews require human authorization
- Durable, resumable wait states for approval gates — explicit lifecycle transitions, resume tokens, and time-based expiry via `exactl wait approve|reject|amend|expire`

### 4. **Multi-Provider Support**

- Local-first: Ollama (no cloud required)
- Cloud options: Claude, GPT, Gemini (🟢 all editions)
- Vertex AI: Google service-account auth for project-based quotas and regional endpoints (🟢 all editions; `@exaix/ai-vertex`)
- OpenRouter: unified gateway to many models (ships in the Solo build; positioned as a 🔵 Team+ differentiator; `@exaix/ai-openrouter`)
- Enterprise providers: Azure OpenAI, AWS Bedrock (🟣 Enterprise)
- Provider factory pattern for extensibility; concrete providers register at bootstrap via `apps/common/registry_bootstrap.ts`
- Cost management with edition-tiered capabilities

### 5. **Portal System**

- Symlink-based external project access
- Context cards for agent understanding
- Scoped permissions (Deno security model)
- Multi-project refactoring support

### 6. **Edition-Aware Architecture**

- Core components available in all editions (🟢 Solo)
- Collaboration features in Team+ (🔵 Team)
- Governance and compliance features in Enterprise (🟣 Enterprise)
- Transparent feature tiering with upgrade path

---

## Execution Semantics

Exaix's reliability rests on three layered guarantees — each inspectable through the Activity Journal, CLI, and flow artifacts rather than asserted as marketing language:

1. **Visibility** — Every significant runtime transition emits a typed, versioned, trace-linked domain event (`DomainEventType`; see the `Event Taxonomy` subsection below). Operators can inspect what happened at any point in a run's lifecycle without reading raw runtime state.
1. **Recoverability** — Step results are persisted with idempotency keys so a failed run can resume from the last successful step rather than recompute from scratch; this resumption path is still maturing and should not yet be relied on as a complete guarantee. Long-running execution context is managed and compacted automatically by the Context Budget Manager (see the `Context Budget Management` subsection below).
1. **Governance** — Human approval gates are first-class durable wait states with explicit lifecycle transitions, resume tokens, and operator-driven resolution via `exactl wait approve|reject|amend|expire` (see `Request Quality Gate` below and `packages/flow/README.md` for the full wait-state lifecycle).

Together these three tiers answer the question every operator asks before trusting an agent with a codebase: _what is it doing right now, can it recover from a transient failure without starting over, and can a human stop it before it commits to something irreversible?_

### Semantic Progress Milestones

Milestone events are higher-level projections of domain events for operator-facing UX surfaces. They follow a stable enumerated taxonomy defined in `packages/schemas/src/milestone_event.ts:ExecutionMilestoneSchema` and are emitted via `packages/core/src/observability/milestone_emitter.ts:IMilestoneEmitter`.

- **Schema**: `ExecutionMilestoneSchema` (Zod) validates `milestoneId` (UUID), `traceId`, `milestoneType` (18-value enum), `requiresAttention` flag, `attentionReason`, `progressHint` (steps completed/total/current label), `occurredAt` timestamp, and `summary` (printable ASCII).
- **Emitter interface**: `IMilestoneEmitter` exposes `emit(milestone: IExecutionMilestone): Promise<void>`. A `NoopMilestoneEmitter` provides a no-op default when milestone streaming is disabled.
- **Bridge to SSE**: `MilestoneEventBusEmitter` implements `IMilestoneEmitter` and publishes milestones as `IStreamingEvent` with type `"milestone"` via `EventBusService`, making them available to the SSE endpoint and CLI `watch` command.
- **Design invariant**: Milestones are projections of existing domain events — they do not replace domain events or change execution semantics. The `requiresAttention` flag enables operator notification for approval gates and other human-in-the-loop scenarios.

---

## Storage & Data Flow

Exaix uses a **tiered database architecture** aligned with edition requirements:

| Edition           | Audit Database           | Compliance Level                               |
| ----------------- | ------------------------ | ---------------------------------------------- |
| **Solo** 🟢       | SQLite (embedded)        | Basic audit logging                            |
| **Team** 🔵       | PostgreSQL (append-only) | Multi-user with database-enforced immutability |
| **Enterprise** 🟣 | PostgreSQL + immudb      | WORM-compliant, cryptographically verified     |

```mermaid
flowchart TB
    subgraph FileSystem["File System (~/Exaix)"]
        Workspace["Workspace/<br/>Requests & Plans"]
        Blueprint["Blueprints<br/>Agents & Flows"]
        Memory["Memory<br/>Memory Banks"]
        Portals["Portals<br/>Symlinks"]
        Runtime[".exa/<br/>Active & Archive"]
    end

    subgraph Database["Activity Journal (Edition-Tiered)"]
        Solo[("🟢 SQLite<br/>journal.db")]
        Team[("🔵 PostgreSQL<br/>append-only")]
        Enterprise[("🟣 immudb<br/>WORM")]
    end

    subgraph Services["Services"]
        DB["DatabaseService"]
        Event["EventLogger"]
        Config["ConfigService"]
        Git["GitService"]
    end

    Workspace -->|Watch| Watcher["File Watcher"]
    Blueprint -->|Read| ReqProc["Request Processor"]
    Memory -->|Generate| CtxCard["Context Card Gen"]
    Portals -->|Access| AgentRun["Agent Runner"]
    Runtime -->|Store| Archive["Archive Service"]

    Solo --> DB
    Team --> DB
    Enterprise --> DB
    DB --> Event
    Config --> FileSystem
    Git --> FileSystem

    classDef storage fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef db fill:#b2dfdb,stroke:#00695c,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px

    class Workspace,Blueprint,Memory,Portals,Runtime storage
    class Solo,Team,Enterprise db
    class DB,Event,Config,Git service
```

---

## Parsing & Schema Layer

Exaix centralizes file-format parsing and validation into two layers:

- **Parsers** (`packages/core/src/parsing/`): extract structure from Markdown files (YAML frontmatter + body).
- **Schemas** (`packages/schemas/src/`): validate structured objects using Zod (requests, plans, flows, portals, MCP).

This layer is what keeps file-driven workflows safe and deterministic: request/plan files may come from humans or LLMs, but the runtime only proceeds when schemas validate.

For the key modules table with file paths and sub-schema listings, see `docs/Reference_Data.md#parsing--schema-layer--key-modules`.

---

## Request Analysis Layer

The `RequestAnalyzer` performs intent extraction before routing, identifying goals, requirements, constraints, and ambiguities. It classifies complexity and actionability to guide provider selection and execution strategy. Analysis runs in three modes (Heuristic / LLM / Hybrid) with a default actionability threshold of 80.

For analysis mode details, data flow steps, and hardening additions, see `packages/request/README.md#request-analysis-layer`.

---

## Request Processing Flow

<!-- AGENT_LOGIC: {
  "flow": "Request Processing Loop",
  "steps": [
    "CLI/Daemon creates request file in Workspace/Requests",
    "File Watcher triggers RequestProcessor",
    "RequestProcessor validates and initializes context",
    "RequestAnalyzer extracts intent and requirements",
    "RequestProcessor routes internally: agent requests to AgentRunner, flow requests to FlowRunner",
    "AgentRunner executes agent task and generates Plan via AI Provider (ProviderFactory chain)",
    "FlowRunner executes multi-agent flow with declared/dynamic steps via AgentExecutorAdapter",
    "PlanWriter materializes Plan to Workspace/Plans",
    "FlowRunner pauses on failing quality gates, creating durable wait states for operator resolution",
    "Operator approves, rejects, or amends wait states via `exactl wait` CLI commands",
    "Activity Journal records lifecycle events (including wait-state events)"
  ]
} -->

For the step table (component→file path mapping), sequence diagram, and analysis mode details, see `packages/request/README.md`.

For frontmatter YAML examples, request type samples, flow validation rules, routing policy audit events, and CLI inspection commands, see `packages/request/README.md#request-routing`.

---

## Request Quality Gate

The **Request Quality Gate** is a pre-execution filter that assesses every incoming request body before routing. It prevents vague or unactionable requests from consuming LLM budget and provides an iterative Q&A loop to improve request quality.

When a quality gate step fails during flow execution and a `waitStateService` is configured, the `FlowRunner` creates a **durable wait state** that pauses the flow until an operator resolves it via `exactl wait approve|reject|amend|expire`. This replaces the previous feedback-loop retry model with an explicit asynchronous approval workflow with resume tokens and time-based expiry.

The gate produces one of four recommendations: **PROCEED**, **AUTO_ENRICH**, **NEEDS_CLARIFICATION**, or **REJECT** — each with configurable score thresholds. Assessment runs in `heuristic`, `llm`, or `hybrid` mode.

For thresholds, assessment modes, Q&A protocol, session structure, configuration schema, and CLI commands, see `packages/quality-gate/README.md#request-quality-assessment`.

---

## Acceptance Criteria Propagation

Acceptance criteria propagation closes the gap between "what was asked" and "what quality gates evaluate" by propagating extracted acceptance criteria through the entire evaluation pipeline.

Verification occurs at **three independent layers**:

1. **Quality Gate** (blocking, post-step) — `GateEvaluator` invoked synchronously by `FlowRunner` after guarded agent steps; blocks the flow if scores fall below threshold.

1.

All three layers degrade gracefully when `IRequestAnalysis` is absent: gates use only static criteria, `ReflexiveAgent` omits the requirements block, and `ConfidenceScorer` applies no goal-alignment penalty.

For criteria generation rules, gate configuration, built-in criteria definitions, critique prompt format, and scoring formulas, see `packages/quality-gate/README.md#acceptance-criteria-propagation`.

---

## Plan Execution Flow {#plan-execution-flow}

<!-- AGENT_LOGIC: {
  "flow": "Plan Execution Loop",
  "steps": [
    "PlanWatcher detects approved plan in Workspace/Active",
    "Daemon initializes PlanExecutor with plan path",
    "PlanExecutor parses Plan and loads execution context",
    "ReAct loop starts for each step in the plan",
    "AI Provider proposes tool actions in structural TOML",
    "ToolRegistry validates and executes requested tools",
    "GitService commits atomic changes and generates trace metadata",
    "Activity Journal persists results for auditing"
  ]
} -->

The **Plan Executor** service orchestrates the step-by-step execution of approved plans. It uses a ReAct-style loop to prompt the LLM for actions, executes them via the **Tool Registry**, and commits changes to Git after each step.

For the step table, sequence diagram, component hierarchy, MCP server implementation notes, tool execution paths and ownership map, plan file structure diagram, and activity logging events, see `packages/execution/README.md`.

---

For flow namespace coordination, error recovery, parallel execution groups, and
wait states, see `packages/flow/README.md`. Step-level durability and replay —
idempotency-keyed step persistence enabling resumption from the last successful
step rather than recomputation from scratch — is still maturing and should not
yet be relied on as a complete guarantee.

---

## AI Provider Architecture {#ai-provider-architecture}

Provider integrations are organized as independent packages (`@exaix/ai-anthropic`, `@exaix/ai-openai`, `@exaix/ai-google`, `@exaix/ai-vertex`, `@exaix/ai-openrouter`, `@exaix/ai-ollama`), selected via `ProviderSelector` → `CircuitBreaker` → `ProviderFactory` and registered at bootstrap by `apps/common/registry_bootstrap.ts`.

For the provider component table and edition availability matrix, see `packages/ai/README.md#provider-components`.

---

## Agent Orchestration Architecture

Advanced agent orchestration capabilities provide improved output quality, reliability, and context awareness.

### Orchestration Components

The agent orchestration flow runs: request → session memory → reflexive
agent → output validation → retry/confidence → tool reflection → response.

### Service Responsibilities

For the service responsibilities table (Session Memory, Reflexive Agent, Output Validator, Retry Policy, Confidence Scorer, Tool Reflector), see `packages/flow/README.md#evaluation-components`.

---

## ReAct Reasoning Engine

Exaix implements a ReAct (Reasoning + Acting) reasoning engine for dynamic flow step execution. This enables LLM-driven tool selection within declared permission boundaries while maintaining full auditability.

### Dynamic vs Declared Execution Modes

| Mode            | Description                                         | Use Case                                    |
| --------------- | --------------------------------------------------- | ------------------------------------------- |
| **Declared** 🟢 | Tools committed during planning phase (ReWOO-style) | Standard execution with full human approval |
| **Dynamic** 🔵  | Agent selects tools at runtime from permitted set   | Exploratory tasks, codebase analysis        |

### ReAct Loop Architecture

The ReAct loop runs: step objective → blueprint → MCP client → LLM
reasoning → tool call → permission check → observe → iterate/complete.

### Context Budget Management

Dynamic execution is bounded by a two-layer context budget system:

1. **Section-level allocation** (`PromptBudgetAllocator`, `packages/core/src/prompt_budget_allocator.ts`):
   resolves token limits per section (system / plan / portalKnowledge / memory / skills / loopHistory)
   using `SECTION_BASE_WEIGHTS` and `MODEL_CONTEXT_WINDOWS` before the first LLM call.

2. **Segment-level compaction** (`IContextBudgetManager`, `packages/execution/src/context/`):
   runs before each ReAct iteration. It decomposes the accumulated prompt (system prompt, prior
   thoughts as `"reflection"` segments, tool observations as `"tool_result"` segments) into typed
   `IContextSegment[]` units, applies a priority-driven keep / trim / drop policy within each
   section's token limit, and records every decision as an `IContextBudgetDecision`.

Every compaction decision is persisted to `Memory/Execution/{traceId}/` as an
`IContextBudgetSnapshot` and emitted as a `context.budget.compacted` journal event, making
prompt-state hygiene observable and auditable. Protected segment classes (`"system"`,
`"request"`, `"acceptance_criteria"`, `metadata.nonCompactable = true`) are never dropped.

Context budget management is activated by injecting `contextBudgetManager` and (optionally)
`snapshotStore` as the 12th and 13th constructor parameters of `AgentExecutor`. Without that injection the
`_contextBudgetManager` field is `undefined` and budget compaction is silently skipped on
every ReAct iteration. `ReActLoopStrategy` reads both values via `IReActLoopExecutor`.

For segment kinds, priority constants, and the two-tier timing model, see
`packages/execution/README.md#context-budget-manager`.

### Security and Auditability

For the security features table (runtime supervision, permission boundaries, traceability, cost control), see `packages/mcp/README.md#security-boundaries`.

For core interfaces, tool confirmation interceptor flow, blueprint schema extensions, and flow step configuration, see `packages/mcp/README.md`.

---

## Tool Result Validation & Discovery

For remediation behavior details and discovery surface protocol, see `packages/execution/README.md`.

---

## MCP Tool Handlers Architecture

Exaix includes an extensible MCP tool handler system that enables agents to perform file operations, directory management, and system commands within portal boundaries. All tools enforce security boundaries and log executions to the Activity Journal.

### Tool Handler Categories

| Category            | Tools                                                  | Purpose                  |
| ------------------- | ------------------------------------------------------ | ------------------------ |
| **Read-Only**       | `read_file`, `list_directory`, `search_files`          | Exploration and analysis |
| **Write Tools**     | `write_file`, `patch_file`, `delete_file`, `move_file` | File mutations           |
| **Directory Tools** | `create_directory`                                     | Directory management     |
| **Command Tools**   | `run_command`                                          | System command execution |

All tools enforce portal-scoped operations. For the class diagram, patch file strategy, and security boundary details, see `packages/mcp/README.md`.

---

## CLI Commands Architecture

The CLI is organized as command groups (Request, Plan, Review, Git, Daemon, Portal, Blueprint, Dashboard), each extending a shared `BaseCommand` with `CommandContext` for config and database access.

For the command group mermaid diagram and extends-relationship details, see `docs/Reference_Data.md#cli-commands-architecture`.

---

## TUI Dashboard Architecture

The dashboard is an interactive terminal UI launched from the CLI, providing a unified cockpit for Exaix operations.

### Component Architecture

For the dashboard overview (entry point, integrated views), component architecture mermaid diagram, and view integration method listing, see `apps/tui/README.md`.

---

## Memory Banks Architecture {#memory-banks-architecture}

<!-- AGENT_LOGIC: {
  "flow": "Context & Knowledge Retrieval",
  "steps": [
    "ContextLoader identifies active portal/project",
    "RequestProcessor loads Workspace context files (overview, patterns)",
    "MemoryService loads Global Cross-project learnings",
    "Analyst/Agent merges Local + Global context into prompt",
    "PlanExecutor updates memory with new learnings after task completion",
    "CommitTrace annotates Git log with memory references"
  ]
} -->

The Memory Banks system provides persistent knowledge storage for project context, execution history, and cross-project learnings across four bank types (Local, Execution, Global, Skills).

For the bank-type-to-service mapping table, directory structure mermaid, update workflow sequence diagram, CLI command tree, and key components table, see `docs/Reference_Data.md#memory-banks`.

---

## Portal System Architecture

Portals provide symlink-based access to external projects, each tracked by a context card in `Memory/Banks/` and configured via `exa.config.toml`. The system enforces Deno security permissions and generates structured `knowledge.json` for agent consumption.

For the portal architecture mermaid diagram, CLI command details, and knowledge gathering pipeline, see `packages/portal/README.md#knowledge-gathering-pipeline`.

### Knowledge Gathering Pipeline

Automated codebase analysis runs for every portal. `PortalKnowledgeService` runs a configurable analysis pipeline (quick/standard/deep modes) and persists structured knowledge to `Memory/Projects/{alias}/knowledge.json` with staleness-based re-analysis.

For analysis modes, strategies, configuration, CLI commands, and review cleanup semantics, see `packages/portal/README.md`.

### Portal review cleanup semantics

Portal execution supports two execution strategies — `branch` (default) and `worktree` (isolated checkout). Approval merges into the recorded `base_branch`; reject deletes the feature branch. For worktree reviews, approval also removes the checkout and execution pointer.

For full cleanup behavior details, see `packages/portal/README.md#review-cleanup-semantics`.

---

## Blueprint Management System

Blueprints define agent identities, each stored as `Workspace/Blueprints/Identities/{agent_id}.md` with TOML frontmatter specifying provider, model, capabilities, and persona instructions.

For the built-in template list, blueprint CLI commands, and runtime usage flow diagram, see `docs/Reference_Data.md#blueprint-management`.

---

## Daemon Lifecycle

For the daemon state diagram with all transitions and notes, see `docs/Reference_Data.md#daemon-lifecycle`.

---

## Activity Journal Flow {#activity-journal-flow}

For the component table, event flow mermaid diagram, database schema details, and retrieval commands, see `docs/Reference_Data.md#activity-journal`.

### Event Taxonomy {#event-taxonomy}

All event type strings are defined as members of the `DomainEventType` const object in `packages/core/src/events/domain_event_types.ts`. Inline string literals for event actions are prohibited — every emission site must reference a `DomainEventType` member.

Event sources register with `EventRegistry` (`packages/core/src/events/event_registry.ts`) before emitting, which validates the source + event type combination before delegating to `EventLogger`. `EventLogger` is the single delivery gate: console → DB → event bus, in that order.

For the full event type table grouped by domain, see `docs/Reference_Data.md#event-taxonomy`.

---

## Live Execution Streaming

Real-time execution observability via an in-memory event bus, execution heartbeats, an SSE HTTP endpoint, and a CLI watch command.

### Architecture

```text
                           ┌─ MilestoneEventBusEmitter ──┐
                           │  IMilestoneEmitter ──────►  │
                           │  FlowRunner / AgentRunner   │
                           └─────────────┬───────────────┘
                                         │ milestone events
                                         ▼
ReActLoopStrategy ──heartbeat──▶ EventBusService ◀── EventLogger.publish()
                                         │
                                         ▼
                                   SseHandler (GET /api/v1/traces/:id/stream)
                                         │
                                         ▼
                                   WatchCommand (exactl watch <trace_id>)
                                         │
                                         ▼
                               Color-coded terminal output
                               (milestones render as stage
                                indicators + progress hints
                                + attention markers)
```

For the component responsibilities table, key design decisions, and configuration constants, see `docs/Reference_Data.md#live-execution-streaming`.

---

## Scenario Framework Extension

The scenario framework provides comprehensive end-to-end testing for Exaix features including dynamic tool selection, ReAct reasoning, and extended MCP tool handlers. For scenario pack definitions and execution modes, see `docs/Reference_Data.md#scenario-framework`.

---

## Trigger Adapter Layer

The trigger adapter layer defines how external signals (webhooks, cron schedules, filesystem events, CLI invocations, internal daemon events) are translated into a canonical `ExecutionTriggerEnvelope` before entering the ingestion pipeline. All adapters implement `ITriggerAdapter<TRawInput>` from `@exaix/core/triggers`.

<!-- AGENT_LOGIC: {
  "flow": "Trigger Ingestion",
  "steps": [
    "External signal arrives at a source-specific adapter (WebhookAdapter, ScheduleAdapter, FilesystemAdapter, CliAdapter, InternalEventAdapter)",
    "Adapter validates source-specific constraints (HMAC signature, cron syntax, path boundary)",
    "Adapter produces a typed ExecutionTriggerEnvelope with triggerId, source, action, idempotencyKey, subject, payload, metadata, occurredAt",
    "AdapterRegistry dispatches rawInput to the correct registered adapter by TTriggerSource",
    "TriggerIngestionService receives the envelope, applies policy via TriggerPolicyGate, checks idempotency via InMemoryIdempotencyLedger",
    "Accepted envelopes are forwarded to RequestProcessor; rejected envelopes emit TriggerRejected domain events"
  ]
} -->

For operator configuration, adapter-by-adapter reference, HMAC setup, cron rules, path traversal protection, and `AdapterRegistry` usage examples, see `packages/triggers/README.md`.

---

## Developer Tooling Architecture

Exaix includes repository tooling under `scripts/` to keep development workflows deterministic, along with a developer-facing knowledge base under `.copilot/`.

For the full script inventory and `.copilot/` artifact details, see `docs/Reference_Data.md#developer-tooling`.

---

## Module Grounding Index

This section provides explicit grounding for core infrastructure modules and helpers. For the full lookup table, see `docs/Reference_Data.md#module-grounding-index`.

---

## Component Responsibilities

For the full 60+ entry component responsibilities table with file paths and edition tiers, see `docs/Reference_Data.md#component-responsibilities`.

---

## Related Documentation

- **[User Guide](docs/Exaix_User_Guide.md)** — End-user documentation
- **Package and App READMEs** — Implementation reference (formerly `docs/dev/`):
  - `packages/flow/README.md` — Flow engine, orchestration services, session tool integration
  - `packages/request/README.md` — Request processing, analysis, routing
  - `packages/execution/README.md` — Plan execution, tool paths, events, tool result validation
  - `packages/quality-gate/README.md` — Quality assessment pipeline, evaluation criteria
  - `packages/ai/README.md` — AI provider contracts, component table, edition availability
  - `packages/portal/README.md` — Portal analysis, persistence, architecture diagram
  - `packages/mcp/README.md` — MCP tool handlers, ReAct engine, security
  - `apps/tui/README.md` — Terminal UI views, layout, keyboard reference
  - `packages/memory/README.md` — Memory bank architecture, schemas, CLI commands
  - `packages/triggers/README.md` — Trigger adapter layer, adapter sources, HMAC setup, cron rules, path traversal protection
  - `docs/Reference_Data.md` — Edition matrix, scenario packs, scripts, module index, live streaming, component responsibilities, activity journal, daemon lifecycle, event taxonomy
- **[Test Directory Guide](tests/README.md)** — Test structure and package-local test mapping
- **[Testing Helpers](packages/testing/README.md)** - Shared test helpers (`@exaix/testing`)

---
