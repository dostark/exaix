---
name: comparative-analysis
agent: general
tools:
  - read_file
  - write_file
  - patch_file
  - search_files
  - run_command
  - web_search
scope: dev
title: "Comparative Analysis Skill (#comparative-analysis)"
description: "Reverse-engineered from 5 canonical Exaix comparative analysis documents. Produces structured competitive/gap analyses following established Exaix methodology. Requires mandatory pre-analysis comprehension of Exaix's own architecture before any comparison."
short_summary: "Systematic comparative analysis of Exaix vs any competitor/product — differentiator identification, feature matrix, gap analysis, positioning recommendations. Requires mandatory pre-analysis comprehension of ARCHITECTURE.md, GLOSSARY.md, White Paper, and System Architecture Diagram."
version: "1.0.0"
topics: ["comparative-analysis", "competitive-intelligence", "gap-analysis", "positioning", "strategy"]
qwen_skill: comparative-analysis
---

```text
Key points
- Always start by identifying the competitor/product/topic to compare against
- Read canonical comparative analyses as reference patterns before producing new ones
- Use the standard Exaix positioning framework: governance-first, local-first, file-as-API, mandatory human gate
- Output must include: differentiators, feature matrix, gap analysis, improvement suggestions, rejected patterns
- All suggestions must preserve Exaix's 9 core invariants (File-as-API, Mandatory Human Gate, Forensic Trace Chain, Portal Isolation, Daemon-Based Async, Declarative Blueprints, MCP-Native Both Ways, Local-First Operation, Governance-First)
- After producing analysis, update the relevant exaix-dev-docs/dev/ file or create a new one
- Follow submodule-workflow skill for changes spanning parent repo and submodule
- **Ignore marketing nomenclature — map actual architecture and functionality.** When a competitor calls itself an "agentic OS" or "meta-harness", disregard the label and examine their actual code: what interfaces define the execution loop, how are tools registered and dispatched, what is the policy evaluation mechanism, how is state persisted, what is the sandbox boundary. A product's README positioning is a signal; its source code and runtime behavior are the ground truth.

Canonical prompt (short):
"Produce a comparative analysis of Exaix vs {competitor/topic}.
Phase 0: Read ARCHITECTURE.md, .copilot/docs/GLOSSARY.md, exaix-dev-docs/dev/Exaix_White_Paper.md,
         and exaix-dev-docs/dev/System_Architecture_Diagram.md first.
Reference: {existing analysis docs if any}.
Cover: positioning, feature matrix, gaps, improvement suggestions, rejected patterns."

Reference sources (canonical comparative analyses):
  ADK/crewAI/LangChain/etc. → exaix-dev-docs/dev/Exaix_Comparative_Analysis.md
  Credal Agent Registry     → exaix-dev-docs/dev/Exaix_CredalAgentRegistry_Comparative_Analysis.md
  Eval frameworks (SOTA)    → exaix-dev-docs/dev/Exaix_Eval_Comparative_Analysis.md
  Inngest/Utah patterns     → exaix-dev-docs/dev/Exaix_Inngest_Utah_Gap_Analysis.md
  Ruflo                     → exaix-dev-docs/dev/Exaix_Ruflo_Comparative_Analysis.md

MANDATORY — Phase 0: Comprehend Exaix's Own Architecture
  BEFORE any analysis, read ALL four of these documents to internalize Exaix's
  architecture, invariants, terminology, and positioning. The analysis quality
  depends on accurate self-knowledge.

  0a. ARCHITECTURE.md (repo root) — system architecture, component boundaries,
      edition model, execution semantics, pipeline flow, AI provider architecture,
      ReAct loop, MCP tool handlers, memory banks, portal system, activity journal
      → Extract the 9 core invariants (File-as-API, Mandatory Human Gate, etc.)
      → Extract the 3-tier edition model (Solo/Team/Enterprise) and what differs
      → Extract the edition-specific database tiering: SQLite → PostgreSQL → immudb
      → Extract the AI provider architecture: ProviderSelector → CircuitBreaker → ProviderFactory
      → Extract the ReAct loop: step objective → blueprint → MCP client → LLM
        reasoning → tool call → permission check → observe → iterate/complete
      → Extract the portal isolation model (symlink-based, Deno permissions)
      → Extract the event taxonomy (DomainEventType, Activity Journal)
      → Extract the execution semantics: Visibility, Recoverability, Governance
      → Extract the anomaly classification system (severity levels, recovered failures)
      → Extract the guardrail runner architecture (concurrent, non-blocking)

  0b. .copilot/docs/GLOSSARY.md — precise terminology definitions
      → Extract the Actor/Agent/Agent Role distinction:
        - Actor = who initiated (user, service, mcp-client, agent)
        - Agent = runtime execution unit (agent-runner, flow-runner, etc.)
        - Agent Role = LLM persona (resolved from Blueprints/Agents/)
      → Extract the journal field naming conventions:
        actor/actor_type (who), runner_id/runner_kind (how), agent_role (what persona)
      → Extract the pipeline artifact code identifiers:
        ExecutionTriggerEnvelope, IPlanMetadata, IReviewStatus, IChangesetResult
      → Extract wait state lifecycle: resume/approve/reject/amend/expire/cancel
      → Extract traceId vs trace_id naming (camelCase in code, snake_case in DB/payloads)
      → Extract the anomaly classification: severity levels (high/medium/low),
        recovered failure detection, anomaly badge format
      → Extract the directory structure: Blueprints/Agents/, Blueprints/Flows/

  0c. exaix-dev-docs/dev/Exaix_White_Paper.md — governance-first positioning,
      market landscape, competitive moats, compliance frameworks, use cases
      → Extract the core value proposition: "Governance-First AI Agent Operating System"
      → Extract the 4 architectural pillars:
        1. Activity Journal (AI Bill of Materials)
        2. Explicit approval gates (human-in-the-loop governance)
        3. MCP-native interoperability
        4. Deno security model (defense in depth)
      → Extract the 4 competitive moats:
        1. Cumulative Intelligence Advantage (Memory Banks)
        2. Compliance Continuity Lock-In (SOX logs, audit trail)
        3. Workflow Integration Depth (Git hooks, file watchers)
        4. Community Blueprint Network Effects
      → Extract the market positioning map (governance-conscious SMB quadrant)
      → Extract the 3 market segments and Exaix's differentiation in each:
        - IDE agents (Copilot, Cursor): Exaix complements, not competes
        - Orchestration tools (LangChain, AutoGen): governance built-in vs BYO
        - Enterprise platforms (SuperAGI): developer-first, faster deployment
      → Extract the compliance frameworks: EU AI Act, HIPAA, SOX, FedRAMP, NIST 800-171
      → Extract the cost management tiering by edition
      → Extract the use cases: batch processing, compliance/audit, multi-project refactoring

  0d. exaix-dev-docs/dev/System_Architecture_Diagram.md — visual architecture diagrams
      → Extract the CLI layer structure: 8 command groups + TUI dashboard
      → Extract the core daemon pipeline: Request Watcher → Request Processor →
        Request Analyzer → Request Router → Agent Runner/Flow Runner → Execution Loop
      → Extract the services layer: Infrastructure, Context & Prompt, Planning &
        Reporting, Output & Validation, Session & Memory
      → Extract the storage architecture: file system (source of truth) + Activity
        Journal (edition-tiered database)
      → Extract the AI provider selection flow: Selector → Circuit Breaker → Factory → Provider
      → Extract the agent orchestration flow: Request → Session Memory → Agent Runner →
        Reflexive Agent → Output Validator → Confidence Scorer → Retry → Tool Reflector
      → Extract the ReAct loop architecture: Step Objective → Load Blueprint →
        Init Clients → LLM Reasons → Tool Call → Permission Check → Journal → Observe
      → Extract declared vs dynamic execution modes

Exaix core identity (from canonical analyses + ARCHITECTURE.md + White Paper):
  "Governance-First AI Agent Operating System" — occupying a unique quadrant:
  governance-conscious, developer-first, fast-to-deploy.
  Between lightweight IDE agents (no governance) and heavy enterprise platforms (too complex/expensive).
  Built on 4 pillars: Activity Journal (AI-BOM), Explicit Approval Gates, MCP-Native
  Interoperability, Deno Security Model.
  3-tier edition: Solo (MIT, CLI+TUI+SQLite), Team (BSL, +Web UI+PostgreSQL+MCP Server),
  Enterprise (proprietary, +Governance Dashboard+Compliance+immudb).

Comprehension verification (must satisfy before starting Phase 1):
  - State the 9 core invariants from memory (correct order not required)
  - State the 4 architectural pillars from the White Paper
  - Distinguish Actor vs Agent vs Agent Role correctly
  - Name all 3 database tiers and which edition maps to which
  - List the 3 execution semantics guarantees
  - Name the 3 market segments and Exaix's differentiation in each
  - State the 4 competitive moats

Analysis methodology (reverse-engineered from 5 canonicals + Phase 0):
  0. [MANDATORY] Read all 4 Exaix architecture docs (ARCHITECTURE.md, GLOSSARY.md,
     White Paper, System Architecture Diagram) — extract invariants, terminology,
     positioning, and component boundaries before any competitor research
  1. Research competitor deeply (product page, docs, source if available) —
     look past positioning language to examine actual mechanics:
     - What is the execution loop? (ReAct, tool-calling loop, session turn, file pipeline?)
     - How are tools registered and dispatched? (MCP, registry, function callables?)
     - What is the policy/governance mechanism? (pre-execution gate, per-action evaluator, plugin?)
     - How is state persisted? (database, filesystem, in-memory?)
     - What is the sandbox boundary? (OS-level, language-level, none?)
     - Where does the human intervene in the execution flow?
     How does the product actually work at the code and runtime level, not how its marketing describes it?
  2. Establish Exaix architectural baseline with 9 invariants
  3. Build conceptual alignment table (mutual strengths)
  4. Build feature-by-feature comparison matrix
  5. Identify divergence analysis (philosophical differences — do not import)
  6. Build gap analysis (what competitor has that Exaix lacks)
  7. Build reverse gap (what Exaix has that competitor lacks)
  8. Produce improvement suggestions tiered by priority and risk
  9. Identify rejected patterns (explicitly say what NOT to import)
  10. Produce positioning conclusion and roadmap recommendations

Feature comparison dimensions (from canonicals):
  - Fundamental philosophy and identity
  - Agent definition model
  - Multi-agent orchestration
  - Tooling model (MCP client/server)
  - State, session, and memory management
  - Human-in-the-loop (HITL)
  - Audit, compliance, and governance
  - Security model
  - Developer experience and tooling
  - LLM provider and cost management
  - Deployment model
  - Evaluation and quality assurance

Suggestion tiering:
  Priority 1 — Low Risk / High Impact (implement now)
  Priority 2 — Architectural Design Required (design phase)
  Priority 3 — Consider for Enterprise (complex, high reward)
  REJECTED — Violates Exaix invariants

Output format:
  Target file: exaix-dev-docs/dev/Exaix_{Competitor}_Comparative_Analysis.md
  If a file already exists, update it with new findings; otherwise create new.

Do / Don't
  ✅ Do complete Phase 0 (read all 4 architecture docs) before any analysis
  ✅ Do research the competitor deeply before analysis
  ✅ Do read competitor source code — look at the actual execution loop, tool dispatch,
     policy mechanism, sandbox boundary, persistence model, not their README positioning
  ✅ Do map every marketing claim to a concrete code-level mechanism or flag it as unverifiable
  ✅ Do reference existing canonical analyses as patterns
  ✅ Do preserve all 9 Exaix invariants in suggestions
  ✅ Do include explicit rejected patterns section
  ✅ Do tier suggestions by priority
  ✅ Do cite specific architecture doc sections when claiming Exaix capabilities
     (e.g., "As ARCHITECTURE.md §AI Provider Architecture describes...")
  ✅ Do use correct GLOSSARY.md terminology (Actor vs Agent vs Agent Role)
  ❌ Don't skip Phase 0 — comprehension of Exaix's own architecture is mandatory
  ❌ Don't suggest weakening the mandatory human gate
  ❌ Don't suggest cloud dependency for core operation
  ❌ Don't suggest removing file-as-API philosophy
  ❌ Don't suggest dynamic agent spawning without approval bounds
  ❌ Don't confuse Actor (who) with Agent (runtime unit) with Agent Role (LLM persona)
  ❌ Don't reproduce competitor marketing terminology as functional categories —
     "meta-harness", "agentic OS", "AI orchestration layer" describe the product's
     self-positioning, not its architectural mechanism. Use functional descriptions:
     "executor adapter wrapping third-party CLIs", "session-based streaming turn loop",
     "file-driven artifact pipeline".
  ❌ Don't rely solely on the README or splash page — if you cannot verify a claim
     from source code, API docs, or runtime behavior, flag it as "unverifiable"
  ❌ Don't edit TOOLS.md MCP section manually
  ❌ Don't create new exaix-dev-docs files without following submodule-workflow
```

## Output Format

1. **Target file** — which comparative analysis file was created or updated.
1. **Competitor summary** — what was analyzed and key findings.
1. **Gaps identified** — what competitor has that Exaix lacks (tiered).
1. **Strengths identified** — what Exaix has that competitor lacks.
1. **Suggestions** — Priority 1, Priority 2, Priority 3, Rejected.
1. **Positioning conclusion** — where Exaix sits relative to competitor.
1. **Commit payload** — use `#commit` to generate the final structured message.

## Examples

- `#comparative-analysis Compare Exaix vs Google ADK`
- `#comparative-analysis Produce a gap analysis against Inngest durable execution`
- `#comparative-analysis Update the Credal Agent Registry comparison with new findings`

---
exaix:
  skill_id: comparative-analysis
  triggers:
    keywords: [comparative, analysis, competitor, compare, vs, gap-analysis, positioning]
    task_types: [analysis]
    tags: [strategy, competitive-intelligence]
  constraints:
    - "Must complete Phase 0 (read ARCHITECTURE.md, GLOSSARY.md, White Paper, System Architecture Diagram) before any competitor research"
    - "Must research competitor deeply before producing analysis"
    - "Must preserve all 9 Exaix core invariants"
    - "Must include rejected patterns section"
    - "Must tier suggestions by priority/risk"
    - "Must reference existing canonical analyses as structural patterns"
    - "Must follow submodule-workflow for exaix-dev-docs changes"
    - "Must use correct GLOSSARY.md terminology (Actor/Agent/Agent Role distinction)"
    - "Must cite specific doc sections when referencing Exaix capabilities"
    - "Must look past marketing terminology — map actual architecture and functionality from source code or API docs"
    - "Must flag unverifiable claims instead of reproducing them"
  output_requirements:
    - "Target file identified (create or update exaix-dev-docs/dev/Exaix_{Competitor}_Comparative_Analysis.md)"
    - "Feature matrix completed (at least 10 dimensions)"
    - "Gap analysis with priority tiering"
    - "Rejected patterns explicitly documented"
    - "Positioning conclusion with roadmap recommendations"
  quality_criteria:
    - name: architectural_comprehension
      description: Phase 0 completed; Exaix's own architecture, terminology, and positioning accurately represented from all 4 docs
      weight: 20
    - name: depth
      description: Feature comparison covers 10+ dimensions
      weight: 25
    - name: actionability
      description: Suggestions are tiered by priority and risk
      weight: 25
    - name: architectural_safety
      description: All suggestions preserve Exaix's 9 invariants
      weight: 20
    - name: accuracy
      description: Competitor claims verified against real source material; Exaix capabilities cited with correct doc references
      weight: 10
---
