---
title: ARCHITECTURE.md
description: Complete Exaix execution model and component map
agent_priority: critical
copilot_knowledge_base: true
version: 2.1
capabilities: [architecture_overview, execution_flow, memory_bank, portal_ops]
links:
  - "src/services/request/request_processor.ts:RequestProcessor"
  - "src/services/agent/agent_runner.ts:AgentRunner"
  - "src/services/memory/memory_bank.ts:MemoryBankService"
  - "tests/services/request/request_processor_test.ts"
tools_referenced:
  - write_file: src/mcp/handlers/write_file_tool.ts
  - git_commit: src/mcp/handlers/git_tool.ts
copilot_instructions: .copilot/blueprints/senior-coder.md
---

**Version:** 2.0.0\
**Date:** January 16, 2026

This document provides a comprehensive architectural overview of Exaix components using Mermaid diagrams. Exaix is available in **three editions** (Solo, Team, Enterprise) with components differentiated by availability.

> **Edition Legend:** Components marked with 🟢 are available in all editions. Components marked with 🔵 require **Team+** edition. Components marked with 🟣 require **Enterprise** edition.

---

## System Architecture Overview

````mermaid
graph TB
    subgraph Actors["👥 Actors"]
        User[👤 User/Developer]
        Agent[🤖 AI Agent]
    end

    subgraph CLI["🖥️ CLI Layer"]
        Exactl[exactl CLI Entry]
        ReqCmd[Request Commands]
        PlanCmd[Plan Commands]
        ChangeCmd[Review Commands]
        GitCmd[Git Commands]
        DaemonCmd[Daemon Commands]
        PortalCmd[Portal Commands]
        BlueprintCmd[Blueprint Commands]
        DashCmd[Dashboard Commands]
    end

    subgraph TUI["🧩 TUI Layer"]
        TuiDash[TUI Dashboard]
        TuiViews[Views: portals / plans / requests / logs / daemon / agents]
    end

    subgraph Core["⚙️ Core System"]
        Main[main.ts - Daemon]
        ReqWatch[Request Watcher<br/>Workspace/Requests]
        PlanWatch[Plan Watcher<br/>Workspace/Active]
        ReqProc[Request Processor]
        ReqAn[Request Analyzer]
        ReqRouter[Request Router]
        PlanExec[Plan Executor]
        AgentRun[Agent Runner]
        FlowEng[Flow Engine]
        FlowRun[Flow Runner]
        ExecLoop[Execution Loop]
    end

    subgraph Services["🔧 Services"]
        ConfigSvc[Config Service]
        DBSvc[Database Service]
        GitSvc[Git Service]
        EventLog[Event Logger]
        ContextLoad[Context Loader]
        PromptBudget[Prompt Budget Allocator<br/>budget_enforcement<br/>system / plan / portalKnowledge<br/>memory / skills / loopHistory]
        PlanWriter[Plan Writer]
        PlanAdapter[Plan Adapter]
        MissionRpt[Mission Reporter]
        PathRes[Path Resolver]
        ToolReg[Tool Registry]
        CtxCard[Context Card Generator]
        OutputVal[Output Validator]
        RetryPol[Retry Policy]
        ReflexAgt[Reflexive Agent]
        ConfScore[Confidence Scorer]
        SessMem[Session Memory]
        ToolRefl[Tool Reflector]
        CostTrack[Cost Tracker]
        HealthSvc[Health Check Svc]
        ShutDown[Graceful Shutdown]
        InputVal[Input Validator]
        DBPool[DB Conn Pool]
    end

    subgraph Storage["💾 Storage"]
        DB[(SQLite DB<br/>.exa/journal.db)]
        FS[/File System<br/>~/Exaix/]
        Workspace[Workspace/<br/>Requests & Plans/]
        Blueprint[Blueprints/<br/>Agents & Flows/]
        Memory[Memory/<br/>Memory Banks/]
        Portals[Portals/<br/>External Projects/]
        Runtime[/.exa/<br/>Active & Archive/]
    end

    subgraph AI["🤖 AI Providers"]
        Selector[Provider Selector]
        Breaker[Circuit Breaker]
        Factory[Provider Factory]
        Ollama[Ollama<br/>Local]
        Claude[Claude API<br/>Anthropic]
        GPT[OpenAI GPT<br/>Remote]
        Gemini[Google Gemini<br/>Remote]
        Mock[Mock Provider<br/>Testing]
    end

    %% User interactions
    User -->|CLI Commands| Exactl
    User -->|Drop .md files| Requests
    Agent -->|Read/Write| Portals

    %% CLI routing
    Exactl --> ReqCmd
    Exactl --> PlanCmd
    Exactl --> ChangeCmd
    Exactl --> GitCmd
    Exactl --> DaemonCmd
    Exactl --> PortalCmd
    Exactl --> BlueprintCmd
    Exactl --> DashCmd

    %% CLI to Services
    ReqCmd --> Requests
    PlanCmd --> Plans
    ChangeCmd --> GitSvc
    GitCmd --> GitSvc
    DaemonCmd --> Main
    PortalCmd --> ConfigSvc
    PortalCmd --> CtxCard
    BlueprintCmd --> Blueprint
    DashCmd --> TuiDash
    TuiDash --> TuiViews

    %% Core daemon flow
    Main --> ConfigSvc
    Main --> DBSvc
    Main --> ShutDown
    Main --> HealthSvc
    Main --> Factory
    Main --> ReqWatch
    Main --> PlanWatch
    Main --> ReqProc
    Main --> ReqAn
    Main --> ReqRouter
    Main --> PlanExec
    ReqWatch --> Requests
    PlanWatch --> System
    ReqProc --> InputVal
    ReqProc --> ReqAn
    ReqAn --> ReqRouter
    ReqRouter --> AgentRun
    ReqRouter --> FlowRun
    PlanExec --> AgentRun
    AgentRun --> ExecLoop
    ExecLoop --> FlowEng
    FlowRun --> FlowEng

    %% Services integration
    AgentRun --> ContextLoad
    AgentRun --> PromptBudget
    AgentRun --> PlanWriter
    AgentRun --> MissionRpt
    AgentRun --> EventLog
    PromptBudget --> ContextLoad
    ExecLoop --> ToolReg
    ExecLoop --> GitSvc
    ContextLoad --> Memory
    ContextLoad --> Portals
    PlanWriter --> Plans
    PlanWriter --> PlanAdapter
    EventLog --> DB
    GitSvc --> FS
    PathRes --> FS
    DBSvc --> DBPool

    %% AI Provider routing
    AgentRun --> Selector
    Selector --> CostTrack
    Selector --> Breaker
    Breaker --> Factory
    Factory --> Ollama
    Factory --> Claude
    Factory --> GPT
    Factory --> Gemini
    Factory --> Mock

    %% Agent Orchestration (Phase 16)
    AgentRun --> OutputVal
    AgentRun --> RetryPol
    AgentRun --> ReflexAgt
    AgentRun --> ConfScore
    SessMem --> Memory
    AgentRun --> SessMem
    ExecLoop --> ToolRefl

    %% Storage access
    ConfigSvc --> FS
    ConfigSvc --> PromptBudget
    DBSvc --> DB
    ReqProc --> Blueprint
    PlanWatch --> System

    %% Styling
    classDef actor fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef cli fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef core fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef storage fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef ai fill:#fce4ec,stroke:#880e4f,stroke-width:2px

    class User,Agent actor
    class Exactl,ReqCmd,PlanCmd,ChangeCmd,GitCmd,DaemonCmd,PortalCmd,BlueprintCmd,DashCmd cli
    class Main,ReqWatch,PlanWatch,ReqProc,ReqAn,ReqRouter,PlanExec,AgentRun,FlowEng,FlowRun,ExecLoop core
    class ConfigSvc,DBSvc,GitSvc,EventLog,ContextLoad,PromptBudget,PlanWriter,MissionRpt,PathRes,ToolReg,CtxCard,OutputVal,RetryPol,ReflexAgt,ConfScore,SessMem,ToolRefl service
    class DB,FS,Workspace,Blueprint,Memory,Portals,System storage
    class Factory,Ollama,Claude,GPT,Gemini,Mock ai

    class TuiDash,TuiViews cli
```

---

## Edition Model Overview

Exaix follows a **three-tier edition model** to serve different organizational needs:

| Edition | Target Audience | Key Differentiation |
| -------------- | --------------------------------------- | --------------------------------------------------------------------- |
| **Solo** 🟢 | Individual developers, OSS contributors | CLI + TUI, SQLite audit, MCP client, local-first |
| **Team** 🔵 | Small teams, startups, consulting firms | + Web UI, PostgreSQL, MCP server mode, multi-user collaboration |
| **Enterprise** 🟣 | Regulated industries, large enterprises | + Governance dashboard, compliance frameworks, immudb, SSO/SAML |

### Component Availability by Edition

| Component Category | Solo 🟢 | Team 🔵 | Enterprise 🟣 |
| -------------------------- | -------------------------- | ---------------------------- | ------------------------------------- |
| **Interface** | CLI + TUI (7 views) | + Web UI | + Enhanced TUI (9 views) |
| **Audit Database** | SQLite (embedded) | PostgreSQL (append-only) | PostgreSQL + immudb (WORM) |
| **MCP Support** | Client only | + Server mode | + Custom tool development |
| **LLM Providers** | Ollama, OpenAI, Anthropic, Google | + OpenRouter | + Azure OpenAI, AWS Bedrock, GCP Vertex |
| **Memory Banks** | Basic (file-based) | + Full-text search | + Vector search, knowledge graphs |
| **Collaboration** | Single user | Multi-user (unlimited) | + RBAC, department isolation |
| **Compliance** | ❌ | ❌ | ✅ EU AI Act, HIPAA, SOX, ISO 27001 |
| **Cost Management** | Basic logs | Per-user budgets, alerts | Forecasting, anomaly detection |

---

## Request Analysis Layer

The `RequestAnalyzer` performs intent extraction before routing, identifying goals, requirements, constraints, and ambiguities. It classifies complexity and actionability to guide provider selection and execution strategy.

### Phase 49 Hardening Additions

- **Memory-aware analysis**: `RequestProcessor` now retrieves `SessionMemoryService.enhanceRequest()` before analysis and passes the resulting `memoryContext` into `RequestAnalyzer.analyze()`.
- **Structured request context**: YAML frontmatter fields such as `acceptance_criteria`, `expected_outcomes`, and `scope` are promoted into request context before analysis, giving the analyzer high-confidence explicit requirements.
- **Multi-signal complexity**: complexity is driven first by `IRequestAnalysis.complexity`, then by content signals such as body length, bullet count, and file references, with agent-ID matching retained only as a fallback.

### Analysis Modes
- **Heuristic**: Fast, local-only extraction using regex and keyword mapping. Identifies file paths, tech stack, frontmatter-derived expectations, and content-based complexity signals.
- **LLM**: Deep semantic analysis using a language model. Generates structured JSON adhering to `IRequestAnalysis` schema.
- **Hybrid**: First runs heuristic; escalates to LLM only if actionability score falls below a configured threshold (default: 80).

### Data Flow
1. **Trigger**: `exactl request` (via CLI option) or `RequestProcessor` (daemon) detect a new/updated request.
2. **Preparation**: `RequestProcessor` validates frontmatter, materializes structured request context, and loads relevant session memory before analysis.
3. **Execution**: `RequestAnalyzer.analyze()` runs according to the configured mode, using memory context when available.
4. **Persistence**: Results are saved to a sibling `*_analysis.json` file.
5. **Consumption**: `RequestRouter`, `ReflexiveAgent`, and downstream evaluation layers pull analysis context to refine planning, critique, and tool selection.

---

## Request Processing Flow {#request-processing-flow}

<!-- AGENT_LOGIC: {
  "flow": "Request Processing Loop",
  "steps": [
    "CLI/Daemon creates request file in Workspace/Requests",
    "File Watcher triggers RequestProcessor",
    "RequestProcessor validates and initializes context",
    "RequestAnalyzer extracts intent and requirements",
    "RequestRouter selects Agent or Flow runner",
    "Agent/Flow Runner generates Plan via AI Provider",
    "PlanAdapter materializes Plan to Workspace/Plans",
    "Activity Journal records lifecycle events"
  ]
} -->

| Step | Component | Critical Logic Path |
|------|-----------|----------------------|
| 1 | `exactl CLI` | `src/cli/commands/request.ts` |
| 2 | `RequestProcessor` | `src/services/request_processor.ts:RequestProcessor.process()` |
| 3 | `RequestAnalyzer` | `src/services/request_analysis/request_analyzer.ts` |
| 4 | `RequestRouter` | `src/services/request_router.ts:RequestRouter.route()` |
| 5 | `AgentRunner` | `src/services/agent_runner.ts:AgentRunner.execute()` |
| 6 | `PlanAdapter` | `src/services/plan_adapter.ts:PlanAdapter.write()` |


```mermaid
sequenceDiagram
    participant U as User
    participant CLI as exactl CLI
    participant I as Workspace/Requests
    participant W as File Watcher
    participant RP as Request Processor
    participant RA as Request Analyzer
    participant RR as Request Router
    participant FV as Flow Validator
    participant AR as Agent Runner
    participant FR as Flow Runner
    participant AI as AI Provider
    participant PA as Plan Adapter
    participant PS as Plan Schema
    participant P as Workspace/Plans
    participant DB as Activity Journal

    U->>CLI: exactl request "Fix bug"
    CLI->>I: Create request-{uuid}.md
    CLI->>DB: Log request.created
    CLI-->>U: Request created ✓

    W->>I: Detect new file
    W->>RP: Trigger processing
    RP->>I: Read request.md
    RP->>RA: Analyze intent (exactl flag or daemon config)
    RA->>I: Save request_analysis.json
    RP->>RR: Route request (flow vs agent)

    alt Flow Request
        RR->>FV: Validate flow exists
        FV->>FV: Check flow schema & dependencies
        FV-->>RR: Flow valid ✓
        RR->>FR: Generate flow execution plan
        FR->>AI: Generate plan (JSON)
        FR->>PA: Parse & Validate
        PA->>PS: Validate against Zod Schema
    else Agent Request
        RR->>AR: Load identity blueprint
        AR->>AI: Generate plan
        AI-->>AR: Plan response (JSON)
        AR->>PA: Parse & Validate
        PA->>PS: Validate against Zod Schema
    end

    alt Validation Success
        PS-->>PA: Valid Plan Object
        PA->>PA: Convert to Markdown
        PA-->>RP: Markdown Content
        RP->>P: Write plan-{uuid}.md
        RP->>DB: Log plan.generated
        P-->>U: Ready for review
    else Validation Failed
        PS-->>PA: Zod Validation Error
        PA-->>RP: PlanValidationError
        RP->>DB: Log plan.validation_failed
    end

    U->>CLI: exactl plan list
    CLI->>P: Read plans
    CLI-->>U: Show pending plans

    U->>CLI: exactl plan approve {uuid}
    CLI->>P: Update plan status
    CLI->>DB: Log plan.approved
    CLI-->>U: Approved ✓
````

---

## Flow-Aware Request Routing

The **Request Router** service enables intelligent routing of requests based on their frontmatter configuration. It supports both single-agent execution (legacy) and multi-agent flow execution (Phase 7).

### Routing Decision Flow

```mermaid
graph TD
    A[Request Detected] --> B[Parse Frontmatter]
    B --> C{Has 'flow' field?}
    B --> D{Has 'agent' field?}
    B --> E{No routing fields?}

    C -->|Yes| F[Validate Flow]
    F -->|Valid| G[Route to FlowRunner]
    F -->|Invalid| H[Log Error & Fail]

    D -->|Yes| I[Validate Agent]
    I -->|Valid| J[Route to AgentRunner]
    I -->|Invalid| K[Log Error & Fail]

    E -->|Yes| L[Use Default Agent]
    L --> M[Route to AgentRunner]

    G --> N[Generate Flow Plan]
    J --> O[Generate Agent Plan]
    M --> O

    N --> P[Write Plan to Workspace/Plans]
    O --> P
```

Before routing, `RequestProcessor` also performs two Phase 49 hardening steps that are not shown in older diagrams: it loads relevant `SessionMemory` context for the request, and it merges explicit frontmatter expectations into `request.context`. This gives both `RequestAnalyzer` and later execution layers the same grounded view of user intent.

### Structured Request Frontmatter

Requests can now carry machine-readable expectations directly in YAML frontmatter:

```yaml
---
trace_id: "abc-123"
created: 2026-03-16T10:00:00.000Z
status: pending
priority: high
agent: senior-coder
source: cli
created_by: user@example.com
acceptance_criteria:
    - All existing tests pass
    - New endpoint returns 200 for valid input
expected_outcomes:
    - Upload endpoint added at /api/v2/upload
scope:
    include: ["src/api/", "tests/api/"]
    exclude: ["src/legacy/"]
---
```

These fields are parsed by `RequestParser`, propagated through `buildParsedRequest()`, and made available to analysis, quality gates, and critique/evaluation layers.

### Request Types

**Flow Request (Multi-Agent):**

```yaml
---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
flow: code-review
tags: [review, security]
---
Please perform a comprehensive code review of this pull request.
```

**Agent Request (Single-Agent):**

```yaml
---
trace_id: "550e8400-e29b-41d4-a716-446655440001"
agent: senior-coder
tags: [implementation]
---
Implement the new authentication feature.
```

**Default Agent Request:**

```yaml
---
trace_id: "550e8400-e29b-41d4-a716-446655440002"
tags: [general]
---
Help me understand this codebase.
```

### Flow Validation

Before routing to FlowRunner, the Request Router validates:

- **Flow Existence:** Flow blueprint exists in `/Workspace/Blueprints/Flows/`
- **Schema Validity:** Flow conforms to expected structure
- **Dependencies:** All referenced agents and transforms exist
- **No Cycles:** Flow doesn't contain circular dependencies

---

## Parsing & Schema Layer

Exaix centralizes file-format parsing and validation into two layers:

- **Parsers** (`src/parsers/`): extract structure from Markdown files (YAML frontmatter + body).
- **Schemas** (`src/schemas/`): validate structured objects using Zod (requests, plans, flows, portals, MCP).

Key modules:

- `src/parsers/markdown.ts` (`FrontmatterParser`)
  - Extracts YAML frontmatter delimited by `--- ... ---`.
  - Validates frontmatter using `src/schemas/request.ts`.
  - Optionally logs validation events to the Activity Journal via `DatabaseService`.
- `src/schemas/plan_schema.ts`
  - Defines the JSON schema for LLM plan output (title/description + numbered steps + optional metadata).
- `src/schemas/mcp.ts`
  - Defines MCP tool argument schemas and MCP server configuration schema.
- `src/shared/schemas/portal_knowledge.ts` (`PortalKnowledgeSchema`)
  - Validates `IPortalKnowledge` objects produced by `PortalKnowledgeService` (Phase 46).
  - Sub-schemas: `FileSignificanceSchema`, `ArchitectureLayerSchema`, `CodeConventionSchema`, `DependencyInfoSchema`, `SymbolEntrySchema`, `MonorepoPackageSchema`.
- `src/shared/schemas/request_analysis.ts` (`RequestAnalysisSchema`)
  - Validates `IRequestAnalysis` objects used for persistence and runtime context.
  - Enforces field structure for goals, requirements, constraints, and ambiguity analysis.

This layer is what keeps file-driven workflows safe and deterministic: request/plan files may come from humans or LLMs, but the runtime only proceeds when schemas validate.

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

| Step | Component      | Critical Logic Path                                    |
| ---- | -------------- | ------------------------------------------------------ |
| 1    | `PlanWatcher`  | `src/services/watcher.ts:PlanWatcher`                  |
| 2    | `PlanExecutor` | `src/services/plan_executor.ts:PlanExecutor.execute()` |
| 3    | `AIProvider`   | `src/ai/provider_factory.ts`                           |
| 4    | `ToolRegistry` | `src/services/tool_registry.ts:ToolRegistry`           |
| 5    | `GitService`   | `src/services/core/git_service.ts`                     |
| 6    | `EventLogger`  | `src/services/event_logger.ts`                         |

The **Plan Executor** service orchestrates the step-by-step execution of approved plans. It uses a ReAct-style loop to prompt the LLM for actions, executes them via the **Tool Registry**, and commits changes to Git after each step.

```mermaid
sequenceDiagram
    participant W as Plan Watcher
    participant Main as Daemon
    participant PE as Plan Executor
    participant LLM as AI Provider
    participant TR as Tool Registry
    participant Git as Git Service
    participant DB as Activity Journal

    Note over W: Monitors Workspace/Active/

    W->>Main: Detects plan.md
    Main->>PE: execute(planPath)

    PE->>PE: Parse Plan & Context

    loop For Each Step
        PE->>PE: Construct Prompt (Context + Step)
        PE->>LLM: generate(prompt)
        LLM-->>PE: Response (TOML Actions)

        PE->>PE: Parse Actions

        loop For Each Action
            PE->>TR: execute(tool, params)
            TR->>TR: Validate & Run
            TR-->>PE: Result
            PE->>DB: Log action result
        end

        PE->>Git: commit(step_message)
        Git-->>PE: Commit SHA
        PE->>DB: Log step completion
    end

    PE->>Git: commit(final_message)
    Git-->>PE: Final SHA
    PE->>DB: Log plan completion
    PE-->>Main: Execution Result
```

### Plan Execution Components

```mermaid
graph TB
    subgraph Detection[Detection]
        D1[File Watcher<br/>Workspace/Active/]
        D2[Filter _plan.md files]
        D3[Parse YAML frontmatter]
        D4[Validate trace_id]
        D5[Log plan.detected]
    end

    subgraph Parsing[Parsing]
        P1[Extract body section]
        P2[Regex: ## Step N: Title]
        P3[Validate sequential numbering]
        P4[Validate non-empty titles]
        P5[Build step objects]
        P6[Log plan.parsed]
    end

    subgraph Orchestration[Agent Orchestration via MCP]
        O1[Validate portal permissions]
        O2[Start Exaix MCP Server]
        O3[Register MCP tools & resources]
        O4[Connect agent via MCP]
        O5[Monitor agent MCP tool calls]
        O6[Receive review details]
    end

    subgraph MCPServer["Exaix MCP Server"]
        M1[MCP Protocol Handler]
        M2[Tool Registry]
        M3[Resource Registry]
        M4[Prompt Registry]
        M5[Permission Validator]
        M6[Action Logger]
    end

    subgraph MCPTools["MCP Tools (Portal-Scoped)"]
        T1[read_file - Read portal files]
        T2[write_file - Write portal files]
        T3[list_directory - List portal dirs]
        T4[git_create_branch - Create branch]
        T5[git_commit - Commit changes]
        T6[git_status - Check git status]
    end

    subgraph Security["Security Modes"]
        SM1[Sandboxed: No file access]
        SM2[Hybrid: Read-only + audit]
    end

    subgraph Registry[Review Registry]
        R1[Register review record]
        R2[Store commit SHA]
        R3[Link to trace_id]
        R4[Set status = pending]
    end

    subgraph Status[Status Update]
        S1[Mark plan executed]
        S2[Move to Archive]
        S3[Log completion]
    end

    subgraph Error[Error Handling]
        E1[Catch agent errors]
        E2[Catch Git errors]
        E3[Log failures]
        E4[Preserve plan state]
    end

    D1 --> D2 --> D3 --> D4 --> D5
    D5 --> P1
    P1 --> P2 --> P3 --> P4 --> P5 --> P6
    P6 --> G1
    G1 --> G2 --> G3 --> G4
    G4 --> C1
    C1 --> C2 --> C3 --> C4
    C4 --> S1
    S1 --> S2 --> S3

    G2 -.error.-> E1
    C2 -.error.-> E2
    E1 --> E3 --> E4
    E2 --> E3

    classDef implemented fill:#c8e6c9,stroke:#388e3c,stroke-width:2px
    classDef planned fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef error fill:#ffcdd2,stroke:#c62828,stroke-width:2px

    class D1,D2,D3,D4,D5,P1,P2,P3,P4,P5,P6 implemented
    class G1,G2,G3,G4,C1,C2,C3,C4,S1,S2,S3 planned
    class E1,E2,E3,E4 error
```

### MCP Server Implementation Notes

> **Edition Note:** MCP Client functionality is available in **all editions** 🟢. MCP Server mode is available in **Team+** editions only 🔵.

The MCP server lives under `src/mcp/` and supports both **stdio** (JSON-RPC 2.0) and **HTTP/SSE** transports.

- `src/mcp/server.ts`
  - Routes: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`.
  - **Security:** Implements comprehensive CSP and Security Headers for HTTP transport.
  - Logs lifecycle events (e.g., `mcp.server.started`) to the Activity Journal.
- `src/mcp/tools.ts` & `src/mcp/domain_tools.ts`
  - **Foundation Tools:** `read_file`, `write_file`, `list_directory`, `git_*`
  - **Domain Tools:** `exaix_create_request`, `exaix_list_plans`, `exaix_approve_plan`, `exaix_query_journal`
  - Validates tool input using `src/schemas/mcp.ts` and enforces portal access via `PortalPermissionsService`.
- `src/mcp/resources.ts`
  - Implements `portal://<PortalAlias>/<path>` resource discovery and reading.

### Plan File Structure

```mermaid
graph TB
    subgraph PlanFile["_plan.md Structure"]
        FM[YAML Frontmatter<br/>---<br/>trace_id: uuid<br/>request_id: uuid<br/>agent: string<br/>status: approved<br/>---]
        Body[Markdown Body<br/># Plan Title<br/>Description]
        Step1[## Step 1: Title<br/>Content and tasks]
        Step2[## Step 2: Title<br/>Content and tasks]
        StepN[## Step N: Title<br/>Content and tasks]
    end

    subgraph Parsed["Parsed Structure"]
        Context[Context Object<br/>{trace_id, request_id,<br/>agent, status}]
        Steps[Steps Array<br/>[{number, title, content}]]
    end

    FM --> Context
    Body --> Context
    Step1 --> Steps
    Step2 --> Steps
    StepN --> Steps

    Context --> Execution[Plan Executor]
    Steps --> Execution

    classDef file fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef parsed fill:#c8e6c9,stroke:#388e3c,stroke-width:2px
    classDef exec fill:#f3e5f5,stroke:#4a148c,stroke-width:2px

    class FM,Body,Step1,Step2,StepN file
    class Context,Steps parsed
    class Execution exec
```

### Activity Logging Events

**Detection Events:**

- `plan.detected` - Plan file found in Workspace/Active
- `plan.ready_for_execution` - Valid plan parsed, ready for execution
- `plan.invalid_frontmatter` - YAML parsing failed
- `plan.missing_trace_id` - Required trace_id field not found
- `plan.detection_failed` - Unexpected error during detection

**Parsing Events:**

- `plan.parsed` - Plan successfully parsed with step count
- `plan.parsing_failed` - Missing body, no steps, or empty titles
- `plan.non_sequential_steps` - Warning for gaps in step numbering

**Quality Gate Events:**

- `request.quality_gate.assessed` - Quality assessment completed, includes score and recommendation
- `request.quality_gate.enriched` - Request body auto-enriched by LLM before pipeline
- `request.quality_gate.clarification.started` - Q&A clarification session created (status → `refining`)
- `request.quality_gate.failed` - Assessment threw an exception; pipeline continues silently

**Portal Knowledge Events:**

- `portal.analyzed` - Knowledge gathering pipeline completed and `knowledge.json` saved

---

## CLI Commands Architecture

```mermaid
graph LR
    subgraph Entry["Entry Point"]
        Exactl[exactl.ts<br/>Main CLI]
    end

    subgraph Commands["Command Groups"]
        Base[BaseCommand<br/>Shared logic]
        Req[RequestCommands<br/>Create requests]
        Plan[PlanCommands<br/>Review plans]
        Change[ReviewCommands<br/>Review code]
        Git[GitCommands<br/>Git operations]
        Daemon[DaemonCommands<br/>Daemon control]
        Portal[PortalCommands<br/>External projects]
        Blueprint[BlueprintCommands<br/>Agent templates]
        Dashboard[DashboardCommands<br/>TUI dashboard]
    end

    subgraph Context["Shared Context"]
        Ctx[CommandContext<br/>config + db]
    end

    Exactl --> Req
    Exactl --> Plan
    Exactl --> Change
    Exactl --> Git
    Exactl --> Daemon
    Exactl --> Portal
    Exactl --> Blueprint
    Exactl --> Dashboard

    Req -.extends.-> Base
    Plan -.extends.-> Base
    Change -.extends.-> Base
    Git -.extends.-> Base
    Daemon -.extends.-> Base
    Portal -.extends.-> Base
    Blueprint -.extends.-> Base
    Dashboard -.extends.-> Base

    Base --> Ctx

    classDef entry fill:#bbdefb,stroke:#1976d2,stroke-width:2px
    classDef cmd fill:#c8e6c9,stroke:#388e3c,stroke-width:2px
    classDef ctx fill:#fff9c4,stroke:#f57f17,stroke-width:2px

    class Exactl entry
    class Base,Req,Plan,Change,Git,Daemon,Portal,Blueprint,Dashboard cmd
    class Ctx ctx
```

---

## TUI Dashboard Architecture

The dashboard is an interactive terminal UI launched from the CLI, providing a unified cockpit for Exaix operations.

### Overview

- **Entry point:** `exactl dashboard` → `src/cli/dashboard_commands.ts` → `src/tui/tui_dashboard.ts`
- **Multi-pane support:** Split views with independent focus management
- **7 integrated views:** Portal Manager, Plan Reviewer, Monitor, Daemon Control, Agent Status, Request Manager, Memory View
- **Test stability:** Mock services enable comprehensive testing (see `src/tui/tui_dashboard_mocks.ts`)

### Component Architecture

```mermaid
graph TB
    subgraph CLI[CLI Layer]
        Exactl[exactl.ts]
        DashCmd[DashboardCommands.show]
    end

    subgraph Dashboard[TUI Dashboard]
        Launch[launchTuiDashboard]
        State[DashboardViewState]
        Theme[TuiTheme]
    end

    subgraph Panes[Pane Management]
        PaneList[Panes Array]
        Focus[Active Pane Focus]
        Layout[Layout Persistence]
    end

    subgraph Views[Dashboard Views]
        Portal[🌀 PortalManagerView]
        Plan[📋 PlanReviewerView]
        Monitor[📊 MonitorView]
        Daemon[⚙️ DaemonControlView]
        Agent[🤖 AgentStatusView]
        Request[📥 RequestManagerView]
        Memory[💾 MemoryView]
    end

    subgraph Infrastructure[Shared Infrastructure]
        Colors[tui_colors.ts<br/>Theme & colorize]
        Help[tui_help.ts<br/>Help overlays]
        Session[tui_session_base.ts<br/>Base class]
        Raw[Raw mode handling]
    end

    subgraph Notifications[Notification System]
        NotifPanel[Notification Panel]
        NotifTypes[info/success/warning/error]
        AutoExpire[Auto-expire timers]
    end

    Exactl --> DashCmd --> Launch
    Launch --> State
    Launch --> Theme
    Launch --> PaneList
    PaneList --> Focus
    PaneList --> Layout
    Focus --> Views
    Views --> Infrastructure
    Launch --> Notifications
```

### Dashboard State

The `DashboardViewState` manages global UI state:

```typescript
interface DashboardViewState {
  showHelp: boolean; // Help overlay visible
  showNotifications: boolean; // Notification panel visible
  showViewPicker: boolean; // View picker dialog visible
  isLoading: boolean; // Loading indicator
  loadingMessage: string; // Loading message text
  error: string | null; // Error message
  notifications: Notification[]; // Active notifications
  currentTheme: string; // "dark" | "light"
  highContrast: boolean; // Accessibility mode
  screenReader: boolean; // Screen reader support
}
```

### Pane Structure

Each pane manages a view instance with layout information:

```typescript
interface Pane {
  id: string;           // Unique pane identifier
  view: View;           // View instance (PortalManagerView, etc.)
  x: number;            // X position in grid
  y: number;            // Y position in grid
  width: number;        // Pane width (columns)
  height: number;       // Pane height (rows)
  focused: boolean;     // Currently focused
  maximized?: boolean;  // Zoom state
  previousBounds?: {...}; // For restore after maximize
}
```

### Key Bindings

Dashboard uses a declarative key binding system:

| Category        | Keys                      | Actions                           |
| --------------- | ------------------------- | --------------------------------- |
| **Navigation**  | `Tab`, `Shift+Tab`, `1-7` | Pane switching                    |
| **Layout**      | `v`, `h`, `c`, `z`        | Split, close, maximize            |
| **Persistence** | `s`, `r`, `d`             | Save, restore, default            |
| **Dialogs**     | `?`, `n`, `p`, `Esc/q`    | Help, notifications, picker, quit |

### Layout Persistence

Layouts are saved to `~/.exaix/tui_layout.json`:

```json
{
  "panes": [
    { "id": "main", "viewName": "PortalManagerView", "x": 0, "y": 0, "width": 40, "height": 24 },
    { "id": "pane-1", "viewName": "MonitorView", "x": 40, "y": 0, "width": 40, "height": 24 }
  ],
  "activePaneId": "main",
  "version": "1.1"
}
```

### View Integration

Each view extends `TuiSessionBase` and implements:

- `render()`: View-specific rendering
- `handleKey(key: string)`: Keyboard input handling
- `getFocusableElements()`: List of focusable UI elements
- Service injection for data access

### Raw Mode Handling

Terminal raw mode enables immediate key response:

```typescript
tryEnableRawMode(); // Enable for interactive mode
tryDisableRawMode(); // Restore on exit
```

Falls back to line-based input when raw mode unavailable.

### Testing Strategy

- **Unit tests:** Mock services for isolated view testing
- **Integration tests:** Full dashboard lifecycle with test mode
- **Sanitizer safety:** Test mode skips timers to prevent leaks
- **Coverage:** 591+ TUI tests across all components

For keyboard shortcuts, see [TUI Keyboard Reference](./TUI_Keyboard_Reference.md).

---

## AI Provider Architecture {#ai-provider-architecture}

<!-- AGENT_LOGIC: {
  "flow": "LLM Provider Lifecycle",
  "steps": [
    "ConfigService loads [ai] section from exa.config.toml",
    "ProviderFactory selects concrete class based on provider name",
    "Provider instance validates required API keys and base URLs",
    "Request/Plan services call generate(prompt, params)",
    "CostTracker records token usage and estimates USD impact",
    "EventLogger journals generation metrics to Activity Journal"
  ]
} -->

| Component         | Responsibility                | Implementation Path                                     |
| ----------------- | ----------------------------- | ------------------------------------------------------- |
| `ProviderFactory` | Registry & Instance creation  | `src/ai/provider_factory.ts:ProviderFactory`            |
| `BaseProvider`    | Common logic & error handling | `src/ai/providers/common/base_provider.ts:BaseProvider` |
| `CostTracker`     | Token & cost validation       | `src/services/billing/cost_tracker.ts:CostTracker`      |
| `MockProvider`    | Deterministic testing         | `src/ai/providers/mock_provider.ts:MockLLMProvider`     |

Exaix supports multiple LLM providers with **edition-based availability**:

| Provider Category      | Solo 🟢                      | Team 🔵 | Enterprise 🟣                            |
| ---------------------- | ---------------------------- | ------- | ---------------------------------------- |
| **Local**              | ✅ Ollama                    | ✅ All  | ✅ All                                   |
| **Cloud (Basic)**      | ✅ OpenAI, Anthropic, Google | ✅ All  | ✅ All                                   |
| **Cloud (Enterprise)** | ❌                           | ❌      | ✅ Azure OpenAI, AWS Bedrock, GCP Vertex |
| **Cost Management**    | Basic logs                   | Budgets | Forecasting, anomaly detection           |

```mermaid
graph TB
    subgraph Factory["Provider Factory"]
        PF[ProviderFactory.create]
        Info[getProviderInfo]
    end

    subgraph Config["Configuration"]
        Cfg[exa.config.toml<br/>ai.provider<br/>ai.model]
    end

    subgraph BasicProviders["🟢 Basic Providers (All Editions)"]
        Ollama[OllamaProvider<br/>localhost:11434]
        Claude[ClaudeProvider<br/>api.anthropic.com]
        GPT[OpenAIProvider<br/>api.openai.com]
        Gemini[GeminiProvider<br/>generativelanguage.googleapis.com]
        Mock[MockLLMProvider<br/>Testing]
    end

    subgraph EnterpriseProviders["🟣 Enterprise Providers"]
        Azure[AzureOpenAI<br/>your-endpoint.azure.com]
        Bedrock[AWSBedrock<br/>bedrock.amazonaws.com]
        Vertex[GCPVertex<br/>vertex.googleapis.com]
    end

    subgraph Interface["Provider Interface"]
        Gen[generateText<br/>generateStream]
    end

    Cfg --> PF
    PF --> Info
    PF -->|provider=ollama| Ollama
    PF -->|provider=anthropic| Claude
    PF -->|provider=openai| GPT
    PF -->|provider=google| Gemini
    PF -->|provider=mock| Mock
    PF -->|provider=azure| Azure
    PF -->|provider=bedrock| Bedrock
    PF -->|provider=vertex| Vertex

    Ollama -.implements.-> Gen
    Claude -.implements.-> Gen
    GPT -.implements.-> Gen
    Gemini -.implements.-> Gen
    Mock -.implements.-> Gen
    Azure -.implements.-> Gen
    Bedrock -.implements.-> Gen
    Vertex -.implements.-> Gen

    classDef factory fill:#e1bee7,stroke:#6a1b9a,stroke-width:2px
    classDef config fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef provider fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef enterprise fill:#d1c4e9,stroke:#512da8,stroke-width:2px
    classDef interface fill:#b2dfdb,stroke:#00695c,stroke-width:2px

    class PF,Info factory
    class Cfg config
    class Ollama,Claude,GPT,Gemini,Mock provider
    class Azure,Bedrock,Vertex enterprise
    class Gen interface
```

---

## Storage & Data Flow

Exaix uses a **tiered database architecture** aligned with edition requirements:

| Edition           | Audit Database           | Compliance Level                               |
| ----------------- | ------------------------ | ---------------------------------------------- |
| **Solo** 🟢       | SQLite (embedded)        | Basic audit logging                            |
| **Team** 🔵       | PostgreSQL (append-only) | Multi-user with database-enforced immutability |
| **Enterprise** 🟣 | PostgreSQL + immudb      | WORM-compliant, cryptographically verified     |

```mermaid
graph TB
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

| Memory Tier   | Storage Path                  | Primary Consumer  |
| ------------- | ----------------------------- | ----------------- |
| **Local**     | `Workspace/Memory/Projects/`  | `ContextLoader`   |
| **Execution** | `Workspace/Memory/Execution/` | `ActivityJournal` |
| **Global**    | `Workspace/Memory/Global/`    | `MemoryService`   |

The Memory Banks system provides persistent knowledge storage for project context, execution history, and cross-project learnings.

> **Enhanced Architecture:** See [.copilot/planning/phase-12.5-memory-bank-enhanced.md](../.copilot/planning/phase-12.5-memory-bank-enhanced.md) for the full v2 architecture with Global Memory, Agent Memory Updates, and Simple RAG.

### Directory Structure

```mermaid
graph TB
    subgraph Memory["Memory/"]
        Global["Global/<br/>Cross-project learnings"]
        Projects["Projects/<br/>Project-specific memory"]
        Execution["Execution/<br/>Execution history"]
        Pending["Pending/<br/>Awaiting approval"]
        Tasks["Tasks/<br/>Task tracking"]
        Index["Index/<br/>Search indices"]
    end

    subgraph ProjectMem["Projects/{portal}/"]
        Overview["overview.md"]
        Patterns["patterns.md"]
        Decisions["decisions.md"]
        References["references.md"]
        ContextJson["context.json"]
        Knowledge["knowledge.json"]
    end

    subgraph ExecMem["Execution/{trace-id}/"]
        Summary["summary.md"]
        Context["context.json"]
        Changes["changes.diff"]
        Learnings["learnings.md"]
    end

    subgraph GlobalMem["Global/"]
        GLearnings["learnings.md"]
        GPatterns["patterns.md"]
        GAnti["anti-patterns.md"]
        GJson["learnings.json"]
    end

    subgraph IndexDir["Index/"]
        Files["files.json"]
        PatIdx["patterns.json"]
        Tags["tags.json"]
        LearnIdx["learnings.json"]
        Embed["embeddings/"]
    end

    Projects --> ProjectMem
    Execution --> ExecMem
    Global --> GlobalMem
    Index --> IndexDir

    classDef dir fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef file fill:#c8e6c9,stroke:#388e3c,stroke-width:2px
    classDef json fill:#b2dfdb,stroke:#00695c,stroke-width:2px

    class Memory,Global,Projects,Execution,Pending,Tasks,Index dir
    class Overview,Patterns,Decisions,References,Summary,Changes,Learnings,GLearnings,GPatterns,GAnti file
    class ContextJson,Context,GJson,Files,PatIdx,Tags,LearnIdx,Embed,Knowledge json
```

### Memory Update Workflow

```mermaid
sequenceDiagram
    participant Agent as Execution Agent
    participant ME as Memory Extractor
    participant MB as MemoryBankService
    participant P as Memory/Pending/
    participant U as User
    participant G as Memory/Global/

    Note over Agent: Execution completes

    Agent->>ME: triggerMemoryExtraction()
    ME->>ME: analyzeExecution()
    ME->>ME: extractLearnings()

    alt Learnings Found
        ME->>MB: createProposal(learnings)
        MB->>P: Write proposal.md
        MB-->>U: "Memory update pending"

        U->>MB: exactl memory pending approve
        MB->>G: mergeLearning(learning)
        MB->>P: archiveProposal()
    end
```

### CLI Command Tree

```text
exactl memory
├── list                    # List all memory banks
├── search <query>          # Search across memory
├── project list|show       # Project memory ops
├── execution list|show     # Execution history
├── global show|stats       # Global memory
├── pending list|approve    # Pending updates
├── promote|demote          # Move learnings
└── rebuild-index           # Regenerate indices
```

### Key Components

| Component              | Location                                                    | Purpose                           | Status      |
| ---------------------- | ----------------------------------------------------------- | --------------------------------- | ----------- |
| MemoryBankService      | `src/services/memory_bank.ts`                               | Core CRUD operations              | ✅ Complete |
| Memory Schemas         | `src/schemas/memory_bank.ts`                                | Zod validation schemas            | ✅ Complete |
| Memory Extractor       | `src/services/memory_extractor.ts`                          | Learning extraction               | ✅ Complete |
| Memory Embedding       | `src/services/memory_embedding.ts`                          | Vector embeddings for search      | ✅ Complete |
| Memory CLI             | `src/cli/memory_commands.ts`                                | CLI interface                     | ✅ Complete |
| Integration Tests      | `tests/integration/memory_integration_test.ts`              | End-to-end tests                  | ✅ Complete |
| PortalKnowledgeService | `src/services/portal_knowledge/portal_knowledge_service.ts` | Codebase analysis pipeline        | ✅ Complete |
| PortalKnowledgeSchema  | `src/shared/schemas/portal_knowledge.ts`                    | Zod validation for knowledge.json | ✅ Complete |
| KnowledgePersistence   | `src/services/portal_knowledge/knowledge_persistence.ts`    | knowledge.json read/write         | ✅ Complete |

---

## Portal System Architecture

```mermaid
graph TB
    subgraph External["External Projects"]
        Proj1[~/Dev/MyWebsite]
        Proj2[~/Dev/MyAPI]
        Proj3[~/Work/Backend]
    end

    subgraph Portals["Portals Directory"]
        Link1[MyWebsite →]
        Link2[MyAPI →]
        Link3[Backend →]
    end

    subgraph Memory["Memory/Banks"]
        Card1[MyWebsite.md<br/>Context Card]
        Card2[MyAPI.md<br/>Context Card]
        Card3[Backend.md<br/>Context Card]
    end

    subgraph Config["Configuration"]
        TOML[exa.config.toml<br/>portals array]
        Deno[deno.json<br/>permissions]
    end

    subgraph CLI["Portal Management"]
        Add[exactl portal add]
        List[exactl portal list]
        Show[exactl portal show]
        Remove[exactl portal remove]
        Verify[exactl portal verify]
        Refresh[exactl portal refresh]
    end

    Proj1 -.symlink.-> Link1
    Proj2 -.symlink.-> Link2
    Proj3 -.symlink.-> Link3

    Link1 --> Card1
    Link2 --> Card2
    Link3 --> Card3

    Card1 --> TOML
    Card2 --> TOML
    Card3 --> TOML
    TOML --> Deno

    Add -->|Creates| Link1
    Add -->|Generates| Card1
    Add -->|Updates| TOML
    List -->|Reads| TOML
    Show -->|Reads| Card1
    Remove -->|Deletes| Link1
    Verify -->|Checks| Link1
    Refresh -->|Regenerates| Card1

    classDef external fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef portal fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef memory fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef config fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef cli fill:#c8e6c9,stroke:#388e3c,stroke-width:2px

    class Proj1,Proj2,Proj3 external
    class Link1,Link2,Link3 portal
    class Card1,Card2,Card3 memory
    class TOML,Deno config
    class Add,List,Show,Remove,Verify,Refresh cli
```

### Knowledge Gathering Pipeline (Phase 46)

Phase 46 adds automated codebase analysis to every portal. After `ContextCardGenerator`
builds the human-readable context card, `PortalKnowledgeService` runs a configurable
analysis pipeline and persists structured knowledge to
`Memory/Projects/{alias}/knowledge.json`.

**Post-mount flow:**

```text
Portal Mount
  → ContextCardGenerator.generate()         (context card)
  → PortalKnowledgeService.analyze()        (NEW — quick mode by default)
      → DirectoryAnalyzer   (file census)
      → KeyFileIdentifier   (entry points, configs)
      → ConfigFileParser    (package.json, deno.json, …)
      → PatternDetector     (naming / style patterns)
      → ArchitectureInferrer (layer inference)
      → SymbolExtractor     (deno doc — TS/JS only)
  → KnowledgePersistence.save()             → Memory/Projects/{alias}/knowledge.json
```

**Pre-execution flow:**

```text
Request File (.md)
  → RequestParser.parse()
  → RequestQualityGate.assess()             ← Phase 47 (NEW)
  → [Q&A clarification loop if needed]      ← Phase 47 (NEW)
  → RequestAnalyzer.analyze()               ← Phase 45
  → PortalKnowledgeService.getOrAnalyze()   ← Phase 46
  → RequestRouter (agent or flow)
```

**Analysis modes:**

| Mode       | Strategies run    | LLM needed | `quick_scan_limit` applies |
| ---------- | ----------------- | ---------- | -------------------------- |
| `quick`    | 1, 2, 3 (partial) | No         | Yes                        |
| `standard` | 1–5               | Optional   | No                         |
| `deep`     | 1–6               | Yes        | No                         |

**Six analysis strategies:**

| # | Strategy                | Mode(s)                | Notes                                                      |
| - | ----------------------- | ---------------------- | ---------------------------------------------------------- |
| 1 | Directory Census        | quick, standard, deep  | File count, extension breakdown                            |
| 2 | Key File Identification | quick, standard, deep  | Entry points, package.json, deno.json                      |
| 3 | Config File Parsing     | quick†, standard, deep | Reads package.json, deno.json, tsconfig.json               |
| 4 | Pattern Detection       | standard, deep         | Naming conventions, test patterns                          |
| 5 | Architecture Inference  | standard, deep         | Layer inference from directory names and import graph      |
| 6 | Symbol Extraction       | deep only              | `deno doc --json` (TS/JS only; skipped for non-TS portals) |

_† In quick mode, config parsing is capped by `quick_scan_limit`._

**Persistence & staleness:**

- Knowledge is written to `Memory/Projects/{alias}/knowledge.json` and exposed via
  `IProjectMemory["knowledge"]`.
- `staleness_hours` (default: 168 h / 1 week) controls re-analysis:
  if `gatheredAt < now − staleness_hours`, a fresh run is triggered automatically.
- Incremental update: only outdated strategy results are re-run; unchanged results are
  merged from the previous snapshot.
- `portal.analyzed` is emitted to the Activity Journal on each successful save.

**Configuration (`[portal_knowledge]` TOML section):**

```toml
[portal_knowledge]
auto_analyze_on_mount = true      # Trigger analysis on portal add/refresh
default_mode          = "quick"   # quick | standard | deep
quick_scan_limit      = 200       # Max files read per strategy in quick mode
max_files_to_read     = 50        # Hard cap across all strategies
staleness_hours       = 168       # Hours before re-analysis (default: 1 week)
use_llm_inference     = true      # Allow LLM calls in deep-mode strategies
ignore_patterns       = ["node_modules", ".git", "dist", "build", ".next"]
```

**CLI commands:**

```text
exactl portal analyze <alias> [--mode quick|standard|deep] [--force]
exactl portal knowledge <alias> [--json]
```

### Portal review cleanup semantics

Portal execution supports two related concepts that affect how reviews are created and later approved:

- **Target/base branch selection:** Exaix resolves the base branch for portal work by preferring `target_branch` from request/plan frontmatter (set via `exactl request --target-branch ...`), then portal `default_branch` from `exa.config.toml`, and finally repository default branch auto-detection.
- **Execution strategy:** The portal config may set `execution_strategy` to `branch` (default: execute in the portal repo checkout on a feature branch) or `worktree` (execute in an isolated worktree checkout, record `worktree_path`, and write a discoverability pointer at `Memory/Execution/{trace-id}/worktree`).

When portal execution creates a code review, Exaix records `base_branch` (merge target) and (for worktree runs) `worktree_path` on the review. Approval merges the feature branch into the recorded `base_branch`.

The review record is durable (audit/history), but Exaix applies cleanup to avoid accumulating working directories and stale branches:

- **Reject:** Deletes the feature branch (with best-effort handling if the branch is checked out in a worktree).
- **Approve:** Merges the feature branch into the review’s recorded base branch. If the review was executed in an **isolated worktree** (review has `worktree_path`), Exaix removes the worktree checkout, removes the execution pointer at `Memory/Execution/{trace-id}/worktree`, and deletes the feature branch. If the review was executed on a normal branch checkout, Exaix merges but keeps the feature branch.
- **Merge conflict (worktree reviews):** Exaix attempts to abort the merge and removes the worktree checkout + pointer, but keeps the feature branch for human conflict resolution.

Operational note: if you need to inspect or clean up worktrees manually, use `exactl git worktrees list --portal <alias>` and `exactl git worktrees prune --portal <alias>`.

---

## Request Quality Gate (Phase 47)

The **Request Quality Gate** is a pre-execution filter that assesses every incoming request body before routing. It prevents vague or unactionable requests from consuming LLM budget and provides an iterative Q&A loop to improve request quality.

### Assessment Pipeline

```text
Request body text
  → HeuristicAssessor.assess()   (fast, zero-cost signal analysis)
  → [LLMAssessor.assess() if score is borderline and mode is hybrid|llm]
  → Score → Recommendation

Recommendations:
  PROCEED            (score ≥ proceed threshold)   → pipeline continues unchanged
  AUTO_ENRICH        (score ≥ enrichment threshold) → LLM rewrites body, pipeline continues
  NEEDS_CLARIFICATION (score ≥ minimum threshold)  → Q&A loop started, request paused (REFINING)
  REJECT             (score < minimum threshold)    → request failed (FAILED)
```

### Score Thresholds

| Threshold         | Default | Description                                      |
| ----------------- | ------- | ------------------------------------------------ |
| `proceed`         | 70      | At or above: request proceeds immediately        |
| `enrichment`      | 50      | At or above (< proceed): auto-enrich via LLM     |
| `minimum`         | 20      | At or above (< enrichment): start Q&A loop       |
| _(below minimum)_ | —       | Reject or block (if `block_unactionable = true`) |

### Assessment Modes

| Mode        | Strategies                                             | LLM needed |
| ----------- | ------------------------------------------------------ | ---------- |
| `heuristic` | Text signal analysis only                              | No         |
| `llm`       | Full LLM assessment                                    | Yes        |
| `hybrid`    | Heuristic first; escalate to LLM for borderline scores | Optional   |

### Request Status Transitions

Quality gate introduces new status transitions alongside the existing pipeline:

```text
PENDING → REFINING           (NEEDS_CLARIFICATION — Q&A loop started)
REFINING → PENDING           (user answers submitted and accepted, re-enters pipeline)
PENDING → FAILED             (REJECT recommendation)
```

Enrichment (`AUTO_ENRICH`) is transparent — no status change occurs; the enriched body
is used in-memory for all downstream processing.

### Q&A Clarification Protocol

When a request enters the Q&A loop (`NEEDS_CLARIFICATION`):

1. `RequestQualityGate.startClarification(requestId, body)` calls `ClarificationEngine.startSession()`
2. Round 1 questions are generated by the LLM planning agent (up to `max_clarification_rounds`)
3. Session state is saved to `{request-id}_clarification.json` alongside the request file
4. Status is set to `refining` in the request frontmatter
5. User submits answers via `exactl request clarify --answers <json>`
6. `ClarificationEngine.processAnswers()` incorporates answers and re-assesses quality
7. If `satisfied: true`, session status → `user-confirmed`; re-processing is triggered
8. If max rounds reached, session status → `max-rounds`; best effort spec used

### Clarification Session Structure

```text
Workspace/Requests/
├── request-{uuid}.md           ← status: refining (while Q&A active)
└── request-{uuid}_clarification.json
    {
      requestId: string,
      originalBody: string,
      refinedBody?: IRequestSpecification,
      rounds: [ { round, questions, answers?, askedAt } ],
      status: "active" | "user-confirmed" | "max-rounds" | "user-cancelled",
      qualityHistory: [ { round, score, level } ]
    }
```

### IRequestSpecification Output

When clarification completes, `ClarificationEngine` produces an `IRequestSpecification` (SDD contract):

```typescript
interface IRequestSpecification {
  summary: string; // Concise one-line goal
  goals: string[]; // High-level objectives
  successCriteria: string[]; // Testable acceptance criteria
  scope: { includes: string[]; excludes: string[] };
  constraints: string[]; // Technical limits and non-negotiables
  context: string[]; // Background knowledge referenced
  originalBody: string; // Preserved original request text
}
```

### Configuration (`[quality_gate]` TOML section)

```toml
[quality_gate]
enabled                  = true    # false to bypass gate entirely
mode                     = "hybrid" # heuristic | llm | hybrid
auto_enrich              = true    # LLM-rewrite borderline requests
block_unactionable       = false   # hard-block REJECT instead of soft-fail
max_clarification_rounds = 5       # Q&A rounds before auto-proceeding

[quality_gate.thresholds]
minimum    = 20   # 0–100; below this → reject/block
enrichment = 50   # 0–100; below this → auto-enrich
proceed    = 70   # 0–100; at or above → proceed immediately
```

### New Schemas (Phase 47)

| Schema                           | Location                                                  | Purpose                                 |
| -------------------------------- | --------------------------------------------------------- | --------------------------------------- |
| `RequestQualityAssessmentSchema` | `src/shared/schemas/request_quality_assessment.ts`        | Assessment result with score and issues |
| `ClarificationSessionSchema`     | `src/shared/schemas/clarification_session.ts`             | Multi-round Q&A session state           |
| `RequestSpecificationSchema`     | `src/shared/schemas/request_specification.ts`             | Structured SDD output from Q&A engine   |
| `IRequestQualityGateConfig`      | `src/shared/interfaces/i_request_quality_gate_service.ts` | Gate configuration                      |

### CLI Commands

```text
exactl request clarify <id>                     # Show current Q&A questions
exactl request clarify <id> --answers <json>    # Submit answers to current round
exactl request clarify <id> --proceed           # Accept current state and re-queue
exactl request clarify <id> --cancel            # Cancel Q&A, restore PENDING status
```

---

## Acceptance Criteria Propagation (Phase 48)

Phase 48 closes the gap between "what was asked" and "what quality gates evaluate" by propagating extracted acceptance criteria through the entire evaluation pipeline.

### Dynamic Criteria Generation Pipeline

```text
IRequestAnalysis (Phase 45 output)
  → CriteriaGenerator.fromAnalysis()
  → Dynamic EvaluationCriterion[]       (goal_*, ac_* named criteria)
        ↓
  Merge with static CRITERIA (from gate config)
        ↓
  GateEvaluator.evaluate()              ← combined criteria list
  ReflexiveAgent.run()                  ← structured requirements in critique prompt
  ConfidenceScorer.assess()             ← goal alignment factor in score
```

### Criteria Generation Rules

| Source            | Name prefix | Weight | Required | Condition                             |
| ----------------- | ----------- | ------ | -------- | ------------------------------------- |
| Explicit goal P1  | `goal_`     | 2.0    | true     | `priority === 1`                      |
| Explicit goal P2+ | `goal_`     | 1.0    | true     | `priority >= 2`                       |
| Acceptance crit.  | `ac_`       | 1.5    | true     | Always                                |
| Max generated     | —           | —      | —        | Capped at 10 (`MAX_DYNAMIC_CRITERIA`) |

Generated criteria are sorted descending by weight, then merged with static criteria (static wins on name collision).

### Gate Configuration: `includeRequestCriteria`

The flag `includeRequestCriteria` can be set at **step level** or **flow level** (step overrides flow):

```yaml
# Flow-level default (all gate steps inherit)
settings:
  includeRequestCriteria: true

# Step-level override
evaluate:
  agent: quality-judge
  criteria: ["code_correctness"]
  includeRequestCriteria: false # explicitly disables for this step
```

When `includeRequestCriteria: true` and `IRequestAnalysis` is available, `GateEvaluator` merges dynamic criteria with the static list before calling the judge.

### New Built-In Criteria (Phase 48)

| Criterion               | Weight | Required | Category     | Description                                      |
| ----------------------- | ------ | -------- | ------------ | ------------------------------------------------ |
| `GOAL_ALIGNMENT`        | 2.5    | Yes      | Completeness | Every primary goal from the request is addressed |
| `TASK_FULFILLMENT`      | 2.0    | Yes      | Completeness | All explicitly stated requirements are fulfilled |
| `REQUEST_UNDERSTANDING` | 1.5    | No       | Correctness  | Response demonstrates correct task understanding |

New criterion sets added to `CRITERION_SETS`:

| Set                   | Members                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GOAL_ALIGNED_REVIEW` | `GOAL_ALIGNMENT`, `TASK_FULFILLMENT`, `REQUEST_UNDERSTANDING`, `CODE_CORRECTNESS`, `CODE_COMPLETENESS`                             |
| `FULL_QUALITY_GATE`   | `GOAL_ALIGNMENT`, `TASK_FULFILLMENT`, `CODE_CORRECTNESS`, `CODE_COMPLETENESS`, `NO_SECURITY_ISSUES`, `HAS_TESTS`, `ERROR_HANDLING` |

### ReflexiveAgent Enhanced Critique

When `IRequestAnalysis` is passed to `ReflexiveAgent.run(blueprint, request, analysis?)`, the critique prompt is enhanced with structured requirements:

```text
## Specific Requirements to Verify
Goals:
  [E] Implement login feature (priority 1)
  [E] Add tests (priority 2)

## Acceptance Criteria
  • Login must work with OAuth2

For each requirement, state: ✅ MET / ⚠️ PARTIAL / ❌ MISSING
```

The critique output includes `requirementsFulfillment: IRequirementFulfillment[]` — a per-requirement MET/PARTIAL/MISSING status array.

To keep critique prompts bounded, the injected requirements block is capped by `MAX_CRITIQUE_REQUIREMENTS`. When no analysis is available, `ReflexiveAgent` falls back to the generic critique template without the structured requirements section.

### ConfidenceScorer Goal Alignment Factor

When `assess(request, response, traceId?, critique?)` receives a `critique` with `requirementsFulfillment`:

```text
metCount = MET_count + 0.5 × PARTIAL_count
goalAlignmentScore = metCount / totalCount    (clamped 0–1)

finalScore = rawScore × 0.7 + goalAlignmentScore × 100 × 0.3
```

When `critique` is absent or `requirementsFulfillment` is empty, `goalAlignmentScore` defaults to **1.0** — no penalty for pre-Phase-48 flows.

Weights are configurable via `IConfidenceScorerConfig.goalAlignmentWeight` / `existingScoreWeight` (defaults 0.3 / 0.7, from constants `GOAL_ALIGNMENT_CONFIDENCE_WEIGHT` / `EXISTING_SCORE_CONFIDENCE_WEIGHT`).

### Artifact Verification Pipeline

Verification of delivered artifacts against propagated acceptance criteria occurs at **three independent layers**, each triggered at a different point in the execution lifecycle. The layers are complementary: a gate blocks bad output from proceeding; the reflexive critique loop corrects in-flight output before it reaches a gate; confidence scoring communicates residual uncertainty to the caller after execution.

#### Layer 1 — Quality Gate (blocking, post-step)

`GateEvaluator` is invoked synchronously by `FlowRunner` when a `GATE`-type step executes — immediately after the agent step(s) it guards. When `includeRequestCriteria` is enabled and `IRequestAnalysis` is available, the gate evaluates the artifact against the merged static + dynamic criteria set. The judge LLM scores each criterion; the gate **blocks the flow** if the overall score or any required criterion falls below threshold.

#### Layer 2 — Reflexive Critique (iterative, in-flight)

`ReflexiveAgent.run()` embeds structured requirements (goals + acceptance criteria) into the critique prompt on every iteration of the refinement loop. The critique model is asked to classify each requirement as MET, PARTIAL, or MISSING. If requirements are unmet, the agent is directed to revise its response before the loop advances or the response is returned. This layer corrects the artifact _before_ it reaches a gate.

#### Layer 3 — Confidence Scoring (non-blocking, post-execution)

`ConfidenceScorer.assess()` blends requirement-fulfilment evidence from a prior `ReflexiveAgent` critique into the final confidence score. When `requirementsFulfillment` is present in the critique, goal alignment is weighted at 30% of the final score. This layer does not block execution; it communicates to the caller how much confidence to place in the response.

#### Trigger Sequence

```text
RequestAnalyzer.analyze()              → IRequestAnalysis (stored in plan frontmatter)
  ↓
FlowRunner.execute(request, analysis)
  ├─ [agent step]  → artifact produced
  ├─ [GATE step]   → GateEvaluator  (Layer 1: blocks on fail)
  ├─ [reflexive]   → ReflexiveAgent (Layer 2: corrects in-flight)
  └─ [scoring]     → ConfidenceScorer (Layer 3: non-blocking signal)
```

All three layers degrade gracefully when `IRequestAnalysis` is absent (e.g., pre-Phase-45 plans): gates use only static criteria, `ReflexiveAgent` omits the requirements block, and `ConfidenceScorer` applies no goal-alignment penalty.

### New Service

| Service                | Purpose                                                 | Source file                          |
| ---------------------- | ------------------------------------------------------- | ------------------------------------ |
| **Criteria Generator** | Dynamic `EvaluationCriterion[]` from `IRequestAnalysis` | `src/services/criteria_generator.ts` |

---

## Blueprint Management System

```mermaid
graph TB
    subgraph Templates["Built-in Templates"]
        Def[default<br/>Ollama llama3.2]
        Coder[coder<br/>Claude Sonnet]
        Reviewer[reviewer<br/>GPT-4]
        Architect[architect<br/>Claude Opus]
        Researcher[researcher<br/>GPT-4 Turbo]
        Mock[mock<br/>MockLLMProvider]
        Gemini[gemini<br/>Gemini 2.0 Flash]
    end

    subgraph Storage["Blueprints/Identities"]
        Files[/agent_id.md<br/>TOML frontmatter/]
        Validation[Zod Schema<br/>Validation]
    end

    subgraph CLI["Blueprint Commands"]
        Create[exactl blueprint create]
        List[exactl blueprint list]
        Show[exactl blueprint show]
        Validate[exactl blueprint validate]
        Edit[exactl blueprint edit]
        Remove[exactl blueprint remove]
    end

    subgraph Usage["Runtime Usage"]
        Request[exactl request --identity]
        Processor[Request Processor]
        Runner[Agent Runner]
    end

    Def --> Create
    Coder --> Create
    Reviewer --> Create
    Architect --> Create
    Researcher --> Create
    Mock --> Create
    Gemini --> Create

    Create -->|Validates| Validation
    Create -->|Writes| Files
    List -->|Reads| Files
    Show -->|Reads| Files
    Validate -->|Checks| Validation
    Edit -->|$EDITOR| Files
    Remove -->|Deletes| Files

    Request --> Processor
    Processor -->|Loads| Files
    Processor --> Runner
    Runner -->|Executes| AI[AI Provider]

    classDef template fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef storage fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef cli fill:#c8e6c9,stroke:#388e3c,stroke-width:2px
    classDef usage fill:#e1bee7,stroke:#6a1b9a,stroke-width:2px

    class Def,Coder,Reviewer,Architect,Researcher,Mock,Gemini template
    class Files,Validation storage
    class Create,List,Show,Validate,Edit,Remove cli
    class Request,Processor,Runner,AI usage
```

---

## Daemon Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Stopped: Initial state

    Stopped --> Starting: exactl daemon start
    Starting --> Running: PID written, watcher active
    Starting --> Failed: Startup error

    Running --> Stopping: exactl daemon stop
    Running --> Restarting: exactl daemon restart
    Running --> Crashed: Process died

    Stopping --> Stopped: SIGTERM successful
    Stopping --> ForceKill: Timeout (10s)
    ForceKill --> Stopped: SIGKILL sent

    Restarting --> Stopping: Stop phase
    Stopping --> Starting: Start phase

    Crashed --> Stopped: Cleanup PID file
    Failed --> Stopped: Cleanup resources

    Running --> Running: Process requests

    note right of Running
        File Watcher active
        Request Processor running
        Activity Journal logging
        AI Provider connected
    end note

    note right of Stopped
        PID file removed
        No watchers active
        Database closed
    end note
```

---

## Activity Journal Flow {#activity-journal-flow}

<!-- AGENT_LOGIC: {
  "flow": "Event Persistence Cycle",
  "steps": [
    "Event source calls EventLogger with traceId and actionData",
    "EventLogger normalizes event based on IActivityRecord schema",
    "DatabaseService persists event to project-specific SQLite DB",
    "Real-time TUI components refresh views based on DB change data",
    "PortalService aggregates project history for cross-project context"
  ]
} -->

| Role          | Responsibility                  | Implementation Path                              |
| ------------- | ------------------------------- | ------------------------------------------------ |
| `EventLogger` | Interface for system logging    | `src/services/event_logger.ts:EventLogger`       |
| `DBService`   | SQLite persistence & migrations | `src/services/db/service.ts:DatabaseService`     |
| `LogSchema`   | Activity Record validation      | `src/shared/schemas/activity.ts:IActivityRecord` |

```mermaid
graph LR
    subgraph Actors["Event Sources"]
        User[User Actions<br/>CLI commands]
        Daemon[Daemon Events<br/>System lifecycle]
        Agent[Agent Actions<br/>Processing]
        Analyzer[Analyzer Events<br/>Intent extraction]
        Git[Git Operations<br/>Commits]
    end

    subgraph Logger["Event Logger"]
        Log[log method]
        Info[info helper]
        Warn[warn helper]
        Error[error helper]
        Child[child logger]
    end

    subgraph Database["SQLite Journal"]
        Table[(activities table)]
        Cols[id, timestamp,<br/>trace_id, actor,<br/>action, target,<br/>payload, icon]
    end

    subgraph Query["Retrieval"]
        CLI[exactl log tail]
        Trace[Filter by trace_id]
        Audit[Compliance audit]
    end

    User --> Log
    Daemon --> Info
    Agent --> Warn
    Analyzer --> Info
    Git --> Error

    Log --> Table
    Info --> Table
    Warn --> Table
    Error --> Table
    Child --> Table

    Table --> CLI
    Table --> Trace
    Table --> Audit

    Cols -.schema.-> Table

    classDef source fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef logger fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef db fill:#b2dfdb,stroke:#00695c,stroke-width:2px
    classDef query fill:#fff3e0,stroke:#e65100,stroke-width:2px

    class User,Daemon,Agent,Analyzer,Git source
    class Log,Info,Warn,Error,Child logger
    class Table,Cols db
    class CLI,Trace,Audit query
```

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

### 4. **Multi-Provider Support**

- Local-first: Ollama (no cloud required)
- Cloud options: Claude, GPT, Gemini (🟢 all editions)
- Enterprise providers: Azure OpenAI, AWS Bedrock, GCP Vertex (🟣 Enterprise)
- Provider factory pattern for extensibility
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

## Component Responsibilities

| Component                     | Responsibility                                                                                                                                    | Key Files                                                             | Edition  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------- |
| **CLI Layer**                 | Human interface for system control                                                                                                                | `src/cli/*.ts`                                                        | 🟢 All   |
| **Daemon**                    | Background orchestration engine                                                                                                                   | `src/main.ts:Daemon`                                                  | 🟢 All   |
| **Request Watcher**           | Detect new requests in Workspace/Requests                                                                                                         | `src/services/watcher.ts`                                             | 🟢 All   |
| **Plan Watcher**              | Detect approved plans                                                                                                                             | `src/services/watcher.ts`                                             | 🟢 All   |
| **Request Processor**         | Parse requests, generate plans                                                                                                                    | `src/services/request_processor.ts:RequestProcessor`                  | 🟢 All   |
| **Request Router**            | Route requests to Agent/Flow runners                                                                                                              | `src/services/request_router.ts:RequestRouter`                        | 🟢 All   |
| **Request Analyzer**          | `src/services/request_analysis/`                                                                                                                  | Intent, requirements & complexity extraction                          | 🟢 All   |
| **Request Quality Gate**      | Pre-execution quality scoring and Q&A refinement                                                                                                  | `src/services/quality_gate/request_quality_gate.ts`                   | 🟢 All   |
| **Clarification Engine**      | Multi-turn Q&A loop for request refinement                                                                                                        | `src/services/quality_gate/clarification_engine.ts`                   | 🟢 All   |
| **Plan Executor**             | Execute approved plans                                                                                                                            | `src/services/plan_executor.ts`                                       | 🟢 All   |
| **Agent Runner**              | Execute agent logic with LLM                                                                                                                      | `src/services/agent_runner.ts:AgentRunner`                            | 🟢 All   |
| **Flow Runner**               | Execute multi-agent flows                                                                                                                         | `src/flows/flow_runner.ts:FlowRunner`                                 | 🟢 All   |
| **Flow Checkpoint Service**   | Persist and resume completed flow steps                                                                                                           | `src/services/flow/flow_checkpoint_service.ts:FlowCheckpointService`  | 🟢 All   |
| **Flow Namespace Service**    | Shared blackboard persistence and key-based flow coordination                                                                                     | `src/services/flow/flow_namespace_service.ts:FlowNamespaceService`    | 🟢 All   |
| **Flow Reporter**             | Markdown execution report generation per flow run                                                                                                 | `src/services/flow/flow_reporter.ts:FlowReporter`                     | 🟢 All   |
| **Flow Step On-Error**        | Per-step RETRY/FALLBACK/COMPENSATE/ABORT policy                                                                                                   | `src/shared/schemas/flow.ts:ZFlowStepOnError`                         | 🟢 All   |
| **Compensating Transactions** | LIFO rollback tool-calls on step failure                                                                                                          | `src/flows/flow_runner.ts:FlowRunner.executeCompensatingTransactions` | 🟢 All   |
| **Event Logger**              | Write to Activity Journal                                                                                                                         | `src/services/event_logger.ts:EventLogger`                            | 🟢 All   |
| **Config Service**            | Load and validate exa.config.toml                                                                                                                 | `src/config/service.ts:ConfigService`                                 | 🟢 All   |
| **Workspace Execution**       | Agent environment and path resolution                                                                                                             | `src/services/workspace_execution_context.ts`                         | 🟢 All   |
| **Database Service**          | Edition-tiered journal operations                                                                                                                 | `src/services/db.ts`                                                  | 🟢 All   |
| **Git Service**               | Git operations with trace metadata                                                                                                                | `src/services/core/git_service.ts`                                    | 🟢 All   |
| **Provider Factory**          | Create LLM provider instances                                                                                                                     | `src/ai/provider_factory.ts`                                          | 🟢 All   |
| **Context Loader**            | Load context for agent execution                                                                                                                  | `src/services/context_loader.ts`                                      | 🟢 All   |
| **Prompt Budget Allocator**   | Derive prompt budgets from `budget_enforcement` config across `system`, `plan`, `portalKnowledge`, `memory`, `skills`, and `loopHistory` sections | `src/services/context/prompt_budget_allocator.ts`                     | 🟢 All   |
| **Portal Commands**           | Manage external project access                                                                                                                    | `src/cli/portal_commands.ts`                                          | 🟢 All   |
| **Blueprint Commands**        | Manage agent templates                                                                                                                            | `src/cli/blueprint_commands.ts`                                       | 🟢 All   |
| **Dashboard Commands**        | Launch terminal dashboard                                                                                                                         | `src/cli/dashboard_commands.ts`                                       | 🟢 All   |
| **TUI Dashboard**             | Multi-view terminal UI (7-9 views)                                                                                                                | `src/tui/*.ts`                                                        | 🟢 All   |
| **Web UI**                    | Browser-based approval interface                                                                                                                  | `src/web/*`                                                           | 🔵 Team+ |
| **Parsers**                   | Parse markdown + frontmatter                                                                                                                      | `src/parsers/*.ts`                                                    | 🟢 All   |
| **Plan Parser**               | Shared structured plan parsing utility                                                                                                            | `src/services/structured_plan_parser.ts`                              | 🟢 All   |
| **Schemas**                   | Zod validation layer                                                                                                                              | `src/schemas/*.ts`                                                    | 🟢 All   |
| **MCP Client**                | Connect to external MCP servers                                                                                                                   | `src/mcp/client.ts`                                                   | 🟢 All   |
| **MCP Server**                | JSON-RPC server for tool execution                                                                                                                | `src/mcp/server.ts`                                                   | 🔵 Team+ |
| **Blueprint Loader**          | Unified blueprint parsing                                                                                                                         | `src/services/blueprint_loader.ts`                                    | 🟢 All   |
| **Output Validator**          | Schema validation with JSON repair                                                                                                                | `src/services/output_validator.ts`                                    | 🟢 All   |
| **Retry Policy**              | Exponential backoff with jitter                                                                                                                   | `src/services/retry_policy.ts`                                        | 🟢 All   |
| **Plan Adapter**              | JSON validation and markdown conversion                                                                                                           | `src/services/plan_adapter.ts`                                        | 🟢 All   |
| **Plan Writer**               | Format results into structured plans                                                                                                              | `src/services/plan_writer.ts`                                         | 🟢 All   |
| **Request Common**            | Blueprints and request building utilities                                                                                                         | `src/services/request_common.ts`                                      | 🟢 All   |
| **Review Registry**           | Agent-created review management                                                                                                                   | `src/services/review_registry.ts`                                     | 🟢 All   |
| **Path Resolver**             | Portal alias and security path resolution                                                                                                         | `src/services/path_resolver.ts`                                       | 🟢 All   |
| **Skills Service**            | Procedural memory (skills) management                                                                                                             | `src/services/skills.ts`                                              | 🟢 All   |
| **Mission Reporter**          | Execution reports and memory updates                                                                                                              | `src/services/mission_reporter.ts`                                    | 🟢 All   |
| **Prompt Context**            | Structured prompt building utilities                                                                                                              | `src/services/prompt_context.ts`                                      | 🟢 All   |
| **Reflexive Agent**           | Self-critique improvement loop                                                                                                                    | `src/services/reflexive_agent.ts`                                     | 🟢 All   |
| **Tool Reflector**            | Tool result evaluation and retry                                                                                                                  | `src/services/tool_reflector.ts`                                      | 🟢 All   |
| **Session Memory**            | Memory context injection                                                                                                                          | `src/services/session_memory.ts`                                      | 🟢 All   |
| **Confidence Scorer**         | Output confidence assessment                                                                                                                      | `src/services/confidence_scorer.ts`                                   | 🟢 All   |
| **Criteria Generator**        | Dynamic evaluation criteria from request analysis                                                                                                 | `src/services/criteria_generator.ts`                                  | 🟢 All   |
| **Condition Evaluator**       | Flow condition expression eval                                                                                                                    | `src/flows/condition_evaluator.ts`                                    | 🟢 All   |
| **Gate Evaluator**            | Quality gate checkpoint validation                                                                                                                | `src/flows/gate_evaluator.ts`                                         | 🟢 All   |
| **Judge Evaluator**           | LLM-as-a-Judge assessment                                                                                                                         | `src/flows/judge_evaluator.ts`                                        | 🟢 All   |
| **Feedback Loop**             | Iterative refinement control                                                                                                                      | `src/flows/feedback_loop.ts`                                          | 🟢 All   |
| **Evaluation Criteria**       | Quality standards validation                                                                                                                      | `src/flows/evaluation_criteria.ts`                                    | 🟢 All   |
| **Notification Service**      | Memory update and system notifications                                                                                                            | `src/services/notification.ts`                                        | 🟢 All   |
| **Health Check Service**      | System health and resource monitoring                                                                                                             | `src/services/health_check_service.ts`                                | 🟢 All   |
| **Graceful Shutdown**         | Process termination and cleanup management                                                                                                        | `src/services/graceful_shutdown.ts`                                   | 🟢 All   |
| **Governance Dashboard**      | Compliance monitoring and risk scoring                                                                                                            | `src/web/governance/*`                                                | 🟣 Ent   |
| **Compliance Reporter**       | Regulatory compliance exports                                                                                                                     | `src/services/compliance.ts`                                          | 🟣 Ent   |

---

## Agent Orchestration Architecture

Phase 16 introduced advanced agent orchestration capabilities for improved output quality, reliability, and context awareness.

### Orchestration Components

```mermaid
graph TB
    subgraph Orchestration["🎭 Agent Orchestration"]
        Request[Request Input]
        SessMem[Session Memory]
        AgentRun[Agent Runner]
        ReflexAgt[Reflexive Agent]
        OutputVal[Output Validator]
        ConfScore[Confidence Scorer]
        RetryPol[Retry Policy]
        ToolRefl[Tool Reflector]
        Response[Final Response]
    end

    subgraph Memory["💾 Memory Bank"]
        Learnings[Learnings]
        Patterns[Patterns]
        Executions[Executions]
    end

    Request --> SessMem
    SessMem -->|Lookup| Memory
    Memory -->|Context| SessMem
    SessMem -->|Enhanced| AgentRun

    AgentRun --> ReflexAgt
    ReflexAgt -->|Critique| ReflexAgt
    ReflexAgt --> OutputVal

    OutputVal -->|Invalid| RetryPol
    RetryPol -->|Retry| AgentRun
    OutputVal -->|Valid| ConfScore

    ConfScore -->|Low| Response
    ConfScore -->|High| Response

    AgentRun --> ToolRefl
    ToolRefl -->|Reflect| ToolRefl
    ToolRefl --> AgentRun

    classDef orch fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef mem fill:#fff9c4,stroke:#f57f17,stroke-width:2px

    class Request,SessMem,AgentRun,ReflexAgt,OutputVal,ConfScore,RetryPol,ToolRefl,Response orch
    class Learnings,Patterns,Executions mem
```

### Service Responsibilities

| Service               | Purpose             | Key Features                                                  |
| --------------------- | ------------------- | ------------------------------------------------------------- |
| **Session Memory**    | Context injection   | Semantic search, memory lookup, insight saving                |
| **Reflexive Agent**   | Quality improvement | Self-critique, iterative refinement, confidence threshold     |
| **Output Validator**  | Schema validation   | JSON repair, Zod validation, error reporting                  |
| **Retry Policy**      | Failure recovery    | Exponential backoff, jitter, circuit breaker                  |
| **Confidence Scorer** | Quality assessment  | LLM-based scoring, human review flags                         |
| **Tool Reflector**    | Tool execution      | Result evaluation, alternative parameters, parallel execution |

### Data Flow

1. **Request Enhancement**: Session Memory injects relevant context from past interactions

### Configuration

Agent orchestration is configured in `exa.config.toml`:

```toml
[agents]
confidence_threshold = 70  # Flag outputs below this score

[agents.memory]
enabled = true
topK = 5
threshold = 0.3

[agents.retry]
maxAttempts = 5
initialDelay = 1000
backoffMultiplier = 2.0
jitterFactor = 0.5
```

See User Guide Section 6 for detailed configuration reference.

## Flow Namespace & Shared Blackboard

Phase 64 adds a flow-scoped shared blackboard so steps can exchange structured findings without threading every value through transforms. `FlowRunner` delegates persistence to `FlowNamespaceService`, and the namespace artifact lives alongside other execution state under `Memory/Execution/{traceId}/`.

At the architecture level, the important boundary is:

- `FlowRunner` owns wave scheduling and when namespace reads and writes occur.
- `FlowNamespaceService` owns persistence and artifact serialization.
- Flow definitions opt into namespace coordination explicitly rather than enabling implicit global state.

For configuration shape, runtime semantics, storage details, and YAML examples, see:

- `docs/dev/Exaix_Flows.md#shared-namespace-and-blackboard-coordination`
- `docs/dev/Exaix_Flows.md#flow-reporting`

---

## Flow Orchestration Architecture

Phase 15 introduced advanced flow orchestration capabilities for conditional logic, quality gates, and intelligent feedback loops.

## Flow Error Recovery

Phase 63 extends `FlowRunner` with recovery controls so a multi-step flow can preserve completed work, retry transient failures, or unwind prior side effects instead of always restarting from scratch.

At the architecture level, the important boundary is:

- `FlowRunner` selects and applies recovery strategy during execution.
- `FlowCheckpointService` owns resume snapshots and stale-checkpoint invalidation.
- Recovery metadata is runtime state on step results rather than part of the persisted flow definition.

For supported `onError` actions, checkpoint lifecycle, compensation ordering, and recovery metadata details, see:

- `docs/dev/Exaix_Flows.md#error-recovery`
- `docs/dev/Exaix_Flows.md#checkpointing`
- `docs/dev/Exaix_Flows.md#compensation-ordering-and-context-injection`
- `docs/dev/Exaix_Flows.md#recovery-metadata-on-istepresult`

---

## Flow Parallel Execution Groups

Phase 65 extends `FlowRunner` with explicit parallel group declarations and deterministic fan-in merge semantics. Steps that share a `parallel.group` ID within the same dependency wave execute concurrently via `Promise.allSettled`, and downstream steps aggregate results through `mergeFromGroups` with configurable merge modes (`all`, `ordered`, `concat`, `manual`).

At the architecture level, the important boundary is:

- `FlowRunner` owns group detection, concurrent execution, and fan-in aggregation.
- `FlowCheckpointService` captures individual group members by step ID — no schema changes needed; group membership is re-derived from the flow definition at resume.
- Merged outputs are injected via `parallelGroupResults` on `IFlowStepRequest` (not inside `context`), with dates serialized to ISO strings.
- Group lifecycle events (`flow.parallel_group.started`, `flow.parallel_group.completed`, `flow.parallel_group.merge_failed`) use constants from `src/shared/constants.ts`.

For schema definitions, merge mode behavior, event payloads, and YAML examples, see:

- `docs/dev/Exaix_Flows.md#parallel-execution-groups`
- `.copilot/planning/phase-65-parallel-execution-groups.md`

### Flow Evaluation Components

```mermaid
graph TB
    subgraph FlowOrch["🔄 Flow Orchestration"]
        FlowIn[Flow Step Input]
        CondEval[Condition Evaluator]
        GateEval[Gate Evaluator]
        JudgeEval[LLM-as-a-Judge]
        FeedLoop[Feedback Loop]
        EvalCrit[Evaluation Criteria]
        FlowOut[Flow Step Output]
    end

    subgraph Context["📊 Evaluation Context"]
        Variables[Flow Variables]
        StepResults[Step Results]
        Metadata[Execution Metadata]
    end

    FlowIn --> CondEval
    CondEval -->|branch| GateEval
    GateEval -->|quality check| JudgeEval

    Context --> CondEval
    Context --> GateEval
    Context --> JudgeEval

    JudgeEval --> EvalCrit
    EvalCrit -->|criteria met| FlowOut
    EvalCrit -->|criteria failed| FeedLoop
    FeedLoop -->|retry| FlowIn

    GateEval -->|gate passed| FlowOut
    GateEval -->|gate failed| FeedLoop

    classDef flow fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef ctx fill:#fce4ec,stroke:#c2185b,stroke-width:2px

    class FlowIn,CondEval,GateEval,JudgeEval,FeedLoop,EvalCrit,FlowOut flow
    class Variables,StepResults,Metadata ctx
```

### Evaluation Component Responsibilities

| Component               | Purpose               | Key Features                                               |
| ----------------------- | --------------------- | ---------------------------------------------------------- |
| **Condition Evaluator** | Expression evaluation | Safe expression parsing, variable interpolation, operators |
| **Gate Evaluator**      | Quality checkpoints   | Pass/fail criteria, threshold validation, gate actions     |
| **LLM-as-a-Judge**      | AI-powered assessment | Structured rubrics, multi-criteria scoring, explanations   |
| **Feedback Loop**       | Iterative refinement  | Max iterations, convergence detection, state tracking      |
| **Evaluation Criteria** | Quality standards     | Built-in criteria, custom criteria, weighted scoring       |

### Built-in Evaluation Criteria

| Criteria                | Description                                   | Use Case                         |
| ----------------------- | --------------------------------------------- | -------------------------------- |
| `CODE_CORRECTNESS`      | Validates syntax and semantics                | Code generation steps            |
| `HAS_TESTS`             | Ensures test coverage exists                  | TDD workflows                    |
| `FOLLOWS_SPEC`          | Matches specification requirements            | Implementation validation        |
| `IS_SECURE`             | Checks security best practices                | Security-critical flows          |
| `PERFORMANCE_OK`        | Validates performance characteristics         | Optimization workflows           |
| `GOAL_ALIGNMENT`        | Every primary goal from the request addressed | Goal-aware gates (Phase 48)      |
| `TASK_FULFILLMENT`      | All stated requirements fulfilled             | Requirement-aware gates (Ph. 48) |
| `REQUEST_UNDERSTANDING` | Correct understanding of task demonstrated    | Validation gates (Phase 48)      |

### Condition Expression Syntax

Flow conditions support a safe expression language:

```typescript
// Variable access
"status == 'success'";
"count > 10";

// Logical operators
"status == 'success' && confidence >= 80";
"isComplete || hasTimeout";

// Step result access
"steps.validation.passed == true";
"steps.analysis.score >= threshold";
```

### Quality Gate Configuration

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

### Flow Control Data Flow

1. **Step Input**: Flow step receives input with current context

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

### Tool Handler Pattern

All tool handlers follow a consistent pattern:

```mermaid
classDiagram
    class ToolHandler {
        +execute(args): Promise~MCPToolResponse~
        +getToolDefinition(): ToolDefinition
        +validatePortalExists(portal): string
        +validatePermission(portal, identity, operation): void
        +resolvePortalPath(portal, path): string
        +logToolExecution(tool, portal, identity, metadata): void
    }

    class PatchFileTool
    class DeleteFileTool
    class MoveFileTool
    class CreateDirectoryTool
    class RunCommandTool
    class SearchFilesTool

    ToolHandler <|-- PatchFileTool
    ToolHandler <|-- DeleteFileTool
    ToolHandler <|-- MoveFileTool
    ToolHandler <|-- CreateDirectoryTool
    ToolHandler <|-- RunCommandTool
    ToolHandler <|-- SearchFilesTool
```

### Patch File Strategy

The `patch_file` tool uses **exact string replacement** for targeted edits:

**Arguments:**

- `portal` — Portal name
- `path` — File path within portal
- `search` — Exact string to find (must match exactly once)
- `replace` — Replacement string (may be empty for deletion)
- `identity_id` — Identity for permission checks

**Validation rules:**

- If `search` appears 0 times → Error (agent must reconsider)
- If `search` appears 2+ times → Error with count (agent must be more specific)
- If `search` appears exactly 1 time → Apply replacement

### Security Boundaries

All tools enforce portal-scoped operations:

1. **Portal existence check** — Tool validates portal is mounted
2. **Permission validation** — Appropriate `PortalOperation` required
3. **Path traversal prevention** — Path resolver blocks escape attempts
4. **Activity Journal logging** — Every execution logged with trace ID

---

## ReAct Reasoning Engine

Exaix implements a ReAct (Reasoning + Acting) reasoning engine for dynamic flow step execution. This enables LLM-driven tool selection within declared permission boundaries while maintaining full auditability.

### Dynamic vs Declared Execution Modes

| Mode            | Description                                         | Use Case                                    |
| --------------- | --------------------------------------------------- | ------------------------------------------- |
| **Declared** 🟢 | Tools committed during planning phase (ReWOO-style) | Standard execution with full human approval |
| **Dynamic** 🔵  | Agent selects tools at runtime from permitted set   | Exploratory tasks, codebase analysis        |

### ReAct Loop Architecture

```mermaid
graph TB
    subgraph DynamicStep["Dynamic Step Execution"]
        Start[Step Objective]
        LoadBP[Load Identity Blueprint]
        InitClients[Init MCP Client + LLM Client]
        Reason[LLM Reasons Next Action]
        Decide{Decision}
        ToolCall[Call Tool via MCP Client]
        Observe[Observe Result]
        Journal[Log to Activity Journal]
        Done[Step Complete]
    end

    subgraph Boundaries["Permission Boundaries"]
        PermitTools[permitted_tools from Blueprint]
        ReadOnlyCheck[Read-Only Tools Only]
        MaxIter[maxIterations limit]
    end

    Start --> LoadBP
    LoadBP --> InitClients
    InitClients --> Reason

    Reason --> Decide
    Decide -->|tool_call| ToolCall
    Decide -->|complete| Done

    ToolCall --> ReadOnlyCheck
    ReadOnlyCheck -->|valid| Journal
    ReadOnlyCheck -->|invalid| Reason

    Journal --> Observe
    Observe --> MaxIter
    MaxIter -->|more iterations| Reason
    MaxIter -->|max reached| Done

    PermitTools -.-> Reason
    PermitTools -.-> ReadOnlyCheck

    classDef dynamic fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef boundary fill:#fff3e0,stroke:#e65100,stroke-width:2px

    class Start,LoadBP,InitClients,Reason,Decide,ToolCall,Observe,Journal,Done dynamic
    class PermitTools,ReadOnlyCheck,MaxIter boundary
```

### Core Interfaces

**MCP Client:**

- Executes tools by name with validated arguments
- Returns tool definitions with schemas for LLM consumption

**LLM Client:**

- Prompts LLM to reason about next action in ReAct loop
- Parses JSON responses with tool selection or completion decision
- Includes full tool schemas in prompts for accuracy

**Activity Journal:**

- Logs every reasoning step and tool call
- Correlates entries by trace ID for audit trails
- Integrates with Event Logger for persistence

### Component Responsibilities

| Component             | Responsibility                                |
| --------------------- | --------------------------------------------- |
| MCP Client            | Wraps MCP tool handlers for dynamic execution |
| LLM Client            | ReAct reasoning prompt and response parsing   |
| Activity Journal      | Audit logging via Event Logger                |
| Dynamic Step Executor | ReAct loop orchestration                      |
| Flow Runner           | Execution mode dispatch (declared vs dynamic) |

### Security and Auditability

| Feature                   | Implementation                                                  |
| ------------------------- | --------------------------------------------------------------- |
| **Runtime Supervision**   | Dynamic executor enforces read-only tools in dynamic mode       |
| **Permission Boundaries** | Tools restricted to permitted set from blueprint/step           |
| **Full Traceability**     | Every ReAct iteration logged with same trace ID as parent flow  |
| **Cost Control**          | Iteration limit prevents infinite loops and excessive token use |

### Blueprint Schema Extension

Blueprints can declare permitted tools for dynamic execution:

```yaml
---
identity_id: researcher
name: Researcher
model: gpt-4o
permitted_tools:
  - read_file
  - list_directory
  - search_files
---
```

### Flow Step Configuration

Flow steps opt into dynamic execution mode:

```yaml
# Flow step with dynamic execution
steps:
  - id: explore
    name: Explore codebase structure
    identity: researcher
    execution_mode: dynamic # Opt-in for ReAct
    permitted_tools:
      - read_file
      - list_directory
    input:
      source: request
    timeout: 60000 # Timeout in milliseconds
```

---

## Scenario Framework Extension

The scenario framework provides comprehensive end-to-end testing for Exaix features including dynamic tool selection, ReAct reasoning, and extended MCP tool handlers.

### Scenario Packs

| Pack                 | Scenarios | Focus                                                      |
| -------------------- | --------- | ---------------------------------------------------------- |
| `dynamic_execution`  | 4         | Dynamic tool selection, ReAct loops, permission boundaries |
| `mcp_tools_extended` | 5         | New MCP tool handlers in realistic workflows               |
| `integration_e2e`    | 3         | End-to-end flows combining all new features                |

### Execution Modes

| Mode                | Description                      | Use Case                     |
| ------------------- | -------------------------------- | ---------------------------- |
| `auto`              | Runs all steps non-interactively | CI and regression testing    |
| `step`              | Pauses after every step          | Debugging and development    |
| `manual-checkpoint` | Pauses only at marked steps      | Human-in-the-loop validation |

---

## Developer Tooling Architecture

Exaix includes repository tooling under `scripts/` to keep development workflows deterministic.

### .copilot/ Knowledge Base Index & Embeddings

Exaix includes a developer-facing knowledge base under `.copilot/` used to keep AI assistants consistent and repository-aware.

Artifacts:

- `.copilot/manifest.json`: index of agent docs with metadata and chunk references
- `.copilot/chunks/*`: chunked doc text used for retrieval

Build/validation scripts:

- `scripts/build_agents_index.ts`: rebuilds `.copilot/manifest.json` and chunks
- `scripts/verify_manifest_fresh.ts`: checks manifest/chunks are up to date
- `scripts/validate_agents_docs.ts`: validates agent-doc frontmatter/schema

### CI, Scaffolding, and Database Tooling

- `scripts/ci.ts`: orchestrates repository checks and tests in CI-like environments
- `scripts/scaffold.sh`: scaffolds a new Exaix workspace folder structure and templates
- `scripts/setup_db.ts`: initializes `journal.db` schema
- `scripts/migrate_db.ts` + `migrations/*.sql`: applies incremental database migrations

---

## Viewing This Document

### VS Code

- Built-in Mermaid preview (Markdown Preview Enhanced extension recommended)
- Right-click → "Open Preview" or press `Ctrl+Shift+V`

### GitHub/GitLab

- Native Mermaid rendering in markdown files

### Mermaid Live Editor

- `https://mermaid.live/`
- Copy/paste diagram code for editing

### Export Options

- PNG/SVG export via Mermaid Live Editor
- PDF export via VS Code extensions
- HTML with mermaid.js for web viewing

---

## Module Grounding Index

This section provides explicit grounding for core infrastructure modules and helpers to ensure they are reachable during architecture validation.

### Core Infrastructure

- `src/*.ts` (Global enums, constants, and app entry points)
- `src/helpers/*.ts` (Shared utilities)
- `src/mcp/*.ts` (MCP Server implementation and prompts)
- `src/mcp/handlers/*.ts` (MCP Tool implementations)
- `src/schemas/*.ts` (Data validation schemas)
- `src/errors/*.ts` (Shared error classes)
- `src/flows/*.ts` (Flow engine internals)
- `src/memory/*.ts` (Memory management types)
- `src/plans/*.ts` (Execution plan types)
- `src/ai/*.ts` (AI Provider selector and types)
- `src/ai/providers/*.ts` (Concrete LLM providers)
- `src/ai/factories/*.ts` (LLM provider factories)
- `src/config/*.ts` (Configuration schemas and paths)
- `src/cli/*.ts` (CLI command entry points)
- `src/services/*.ts` (Core service implementations)
- `src/services/common/*.ts` (Shared service errors)
- `src/services/decorators/*.ts` (Log and retry decorators)
- `src/services/quality_gate/*.ts` (Request quality gate and clarification engine)
- `src/services/adapters/*.ts` (CLI adapter services)
- `src/services/request_analysis/*.ts` (Request intent analysis)
- `src/shared/interfaces/*.ts` (Service interfaces)
- `src/shared/schemas/*.ts` (Shared validation schemas)
- `src/shared/types/*.ts` (Shared type definitions)

---

## Live Execution Streaming (Phase 67)

Phase 67 adds real-time execution observability via an in-memory event bus, execution heartbeats, an SSE HTTP endpoint, and a CLI watch command.

### Architecture

```text
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
```

### Component Responsibilities

| Component             | Purpose                                      | Key File                                               |
| --------------------- | -------------------------------------------- | ------------------------------------------------------ |
| **EventBusService**   | In-memory pub/sub routed by `traceId`        | `src/services/observability/event_bus_service.ts`      |
| **EventLogger**       | Publishes `IStreamingEvent` to event bus     | `src/services/core/event_logger.ts`                    |
| **ReActLoopStrategy** | Emits heartbeat via `setInterval` during LLM | `src/services/agent/strategies/react_loop_strategy.ts` |
| **SseHandler**        | Bridges HTTP SSE to `EventBusService`        | `src/api/sse_handler.ts`                               |
| **WatchCommand**      | CLI `exactl watch <trace_id>` with colors    | `src/cli/commands/watch.ts`                            |

### Key Design Decisions

- **traceId routing**: Subscribers receive only events matching their requested `traceId`; wildcard (`*`) subscribes to all.
- **Backpressure**: Events dropped for a subscriber if its queue exceeds `EVENT_BUS_MAX_SUBSCRIBER_QUEUE` (1 000).
- **Heartbeat interval**: `EXECUTION_HEARTBEAT_INTERVAL_MS` (5 000 ms) fires only while `provider.generate()` is in flight; cleared in `finally` on success, failure, or cancellation.
- **Security**: SSE endpoint validates `traceId` against UUID schema (OWASP A03); bound to `127.0.0.1` only (OWASP A10); client disconnect triggers unsubscription via `AbortController`.
- **Fallback**: `watch` command queries historical DB events when SSE server is unavailable.

### Streaming Event Types

| Constant                      | Value             | Emitted When                  |
| ----------------------------- | ----------------- | ----------------------------- |
| `STREAMING_EVENT_HEARTBEAT`   | `agent.heartbeat` | Every 5s during LLM wait      |
| `STREAMING_EVENT_TOOL_START`  | `tool.start`      | Tool execution begins         |
| `STREAMING_EVENT_TOOL_END`    | `tool.end`        | Tool execution completes      |
| `STREAMING_EVENT_LLM_STREAM`  | `llm.stream`      | LLM produces streaming output |
| `STREAMING_EVENT_FLOW_STATUS` | `flow.status`     | Flow state changes            |

All constants are defined in `src/shared/constants.ts` and imported by all streaming consumers.

---

## Related Documentation

- **[Implementation Plan](Exaix_Implementation_Plan.md)** - Detailed development roadmap
- **[User Guide](Exaix_User_Guide.md)** - End-user documentation
- **[Technical Spec](Exaix_Technical_Spec.md)** - Deep technical details
- **[White Paper](Exaix_White_paper.md)** - Vision and philosophy
- **[Building with AI Agents](Building_with_AI_Agents.md)** - Development patterns

---

## Footer — Agent Knowledge Base

- **Copilot Rules**: [.copilot/rules.md](./.copilot/rules.md)
- **Blueprints**: [.copilot/blueprints/](./.copilot/blueprints/)
- **Planning**: [.copilot/planning/](./.copilot/planning/)
- **Manifest**: [.copilot/manifest.json](./.copilot/manifest.json)
