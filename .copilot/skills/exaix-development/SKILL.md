---
name: exaix-development
agent: general
tools:
  - read_file
  - write_file
  - patch_file
  - search_files
  - run_command
scope: dev
title: "Exaix Development Skill (#exaix-development)"
description: Develop Exaix source code following TDD-first, patterns, and conventions
short_summary: "Develop Exaix source code — TDD-first, DI patterns, config philosophy, code conventions."
version: "1.0.0"
topics: ["source", "development", "tdd", "patterns", "architecture"]
qwen_skill: exaix-development
---

````text
Key points

- Strict TDD-first: write failing tests before implementation
- Walking skeleton: build end-to-end minimal features (config → db → log → watcher)
- Config philosophy: every magic number should be a config option — measure first, expose tradeoffs
- Question→Action Loop: ask questions → agent investigates → you decide → agent implements
- Keep Problems tab clean: fix TS errors, lints, remove `any` before marking step complete
- Refinement Loop: if you can't write clear success criteria, you aren't ready to code

Canonical prompt (short):
"Implement step {N} from {plan}. Write tests first, then minimal code. Use shared helpers
(initTestDbService, createCliTestContext). Follow Exaix conventions: DI via constructor,
I-prefix interfaces, no magic numbers."

Project structure (key packages)

  packages/ai/              AI/LLM provider contracts and shared utilities
  packages/ai-*/            Concrete providers (anthropic, openai, google, ollama, openrouter)
  packages/ai-vertex/       Vertex AI provider (team-edition)
  packages/core/src/        Config parsers, constants, types, events, security, context
  packages/schemas/         Zod validation schemas
  packages/request/         Request routing, analysis, quality gate
  packages/execution/       Agent orchestration (execution loop, strategies)
  packages/memory/          Memory bank, embedding, knowledge graph
  packages/portal/          Portal codebase analysis, knowledge gathering
  packages/quality-gate/    Request quality gate, clarification engine
  packages/mcp/             MCP manifest, server runtime, tool handlers
  packages/cli/             Base CLI types, formatters, helpers
  apps/daemon/main.ts       Application entry point
  apps/exactl/              CLI concrete commands
  .copilot/                 Developer-agent guidance
  Blueprints/               Runtime agent definitions (identities, skills, flows)

Service pattern — Interface-first, Constructor Injection

  Every injectable service exposes an interface: class Foo → interface IFoo.
  Consumers depend on IFoo, never on Foo. Constructor injection only — pass
  config, db, provider via constructors. No module-level singletons or static
  accessors. Test mocks implement the full interface — never use `as any` or
  object-literals to fake a service. Prefer narrow interfaces (only methods a
  consumer actually calls).

  // GOOD
  interface IGitService { commit(msg: string): Promise<void>; }
  class GitService implements IGitService { ... }
  class PlanExecutor {
    constructor(private git: IGitService, private db: IDatabaseService) {}
  }

  // BAD — concrete dependency or singleton access
  constructor(private git: GitService) {}
  const git = GitService.getInstance();

System constraints

  - Runtime persistence: .exa/Active, Workspace/Requests, Workspace/Plans are the
    "database". Respect file-system atomicity (writeTextFile + atomic rename).
  - Activity Journal: all side-effects MUST be logged via EventLogger to .exa/journal.db.
  - Security modes: Sandboxed (default, no network/fs), Hybrid (read-only portal paths).
    Always use PathResolver to validate paths before access.
  - MCP enforcement: in Hybrid mode, agents read files directly but MUST use MCP
    tools for writes (auditability).
  - Request quality gate: runs on every request before routing. Modes: heuristic,
    llm, hybrid. Outcomes: proceed, auto-enrich, needs-clarification, reject.
    Key interfaces: IRequestQualityGateService, IClarificationSession.
  - Portal knowledge: PortalKnowledgeService builds structured codebase snapshots.
    Use getOrAnalyze() rather than raw file reads. Modes: quick, standard, deep.
  - Acceptance criteria: CriteriaGenerator converts analysis → EvaluationCriterion[].
    GateEvaluator merges dynamic + static criteria. Request complexity selection is
    multi-signal: analysis-derived → content heuristics → agent fallback.

Config constants & magic numbers

  ALL numeric literals > 1 MUST be named constants. Production constants in
  packages/core/src/types/constants.ts with DEFAULT_ prefix. Test constants in
  tests/config/constants.ts with TEST_ prefix. Enforced by deno task check:magic.

  // GOOD
  import { DEFAULT_GIT_COMMAND_TIMEOUT_MS } from "../config/constants.ts";
  const timeout = DEFAULT_GIT_COMMAND_TIMEOUT_MS;

Environment variables

  4 production overrides validated via Zod in @exaix/core/config/env_schema.ts:
  EXA_LLM_PROVIDER, EXA_LLM_MODEL, EXA_LLM_BASE_URL, EXA_LLM_TIMEOUT_MS.
  Use getValidatedEnvOverrides() — never Deno.env.get() directly.
  Test env vars use EXA_TEST_* prefix. Use isTestMode() / isCIMode() helpers.

  // GOOD
  import { getValidatedEnvOverrides } from "../config/env_schema.ts";
  const envOverrides = getValidatedEnvOverrides();
  const provider = envOverrides.EXA_LLM_PROVIDER ?? config.ai?.provider ?? DEFAULT;

Required patterns

  1. Non-blocking async: never setTimeout/setInterval with magic durations. Use
     configurable polling or event-driven with AbortSignal.timeout.
  2. Timeout protection: all subprocess, network, external operations must have
     configurable timeouts via AbortSignal.timeout.
  3. Secure path validation: all file paths validated via PathResolver against
     canonical real paths. No string concatenation for file paths.
  4. File locking: use exclusive file locks for read-modify-write on shared files.
     Atomic writes: write to temp file, rename to target.
  5. Error boundaries: isolate failures — try/catch per step, not per batch.
     Classify errors (ValidationError, AuthError, etc.) with appropriate codes.
  6. Top-level imports — no dynamic import() without documented rationale.
  7. Registry pattern for factory decoupling (ProviderSelector → CircuitBreaker → ProviderFactory).
  8. Module-level JSDoc: @module, @path, @description, @architectural-layer,
     @dependencies, @related-files. Single JSDoc block per method.
  9. EventLogger via constructor injection for domain events.
     BUDGET_EXCEEDED is the sole budget event name.
  10. Event-driven over polling: prefer event-emitting APIs and signal-based
      coordination over while-loops or setInterval.

Prohibited anti-patterns

  - Record<string, unknown> — define a specific interface instead.
  - import * from — explicit named imports only.
  - console.log for production logging — use EventLogger or Logger.
  - Raw SQL CREATE TABLE in tests — use initTestDbService/initActivityTableSchema.
  - Dynamic import() without documented rationale.
  - setTimeout/setInterval with magic durations.
  - Synchronous I/O in async contexts (Deno.readTextFileSync, etc.).
  - Missing timeout on external commands.
  - Path traversal via string concatenation: `${baseDir}/${userInput}`.
  - Race conditions: concurrent read-modify-write without file locking.
  - Tight coupling: concrete class dependencies where IFoo exists; `as any` mocks.
  - Generic error handling: catch (e) { throw new Error("failed") } — loses context.
  - Shared mutable state across concurrent operations.
  - Duplicate JSDoc blocks on the same method.
  - Ternary expressions in JSX — extract to variable or helper.
  - Module-level singletons or static accessors for services.

Implementation verification checklist

  [ ] Tests pass with >90% coverage
  [ ] No blocking operations in async contexts
  [ ] All external operations have timeout protection
  [ ] All file paths securely validated
  [ ] Concurrent operations properly synchronized
  [ ] Error handling follows classification patterns
  [ ] Constants used instead of magic numbers
  [ ] Injectable services implement IFoo; constructors accept interfaces, not classes
  [ ] On a feature branch, not main (Gate 0)
  [ ] Working tree clean before rebase/pull

Plan-driven development workflow

  I want to work on [feature/fix].

  1. READ PLAN: Open .copilot/planning/phase-XX-*.md or docs/Exaix_Implementation_Plan.md
  2. UNDERSTAND: Read the step's Action, Success Criteria, referenced docs
  3. IMPLEMENT: TDD if code changes, update docs if needed
  4. VERIFY: Check all success criteria met, run tests, update step status
  5. MARK COMPLETE: Update planning doc checkboxes to [x], note deviations

  When no step exists, create one: #### Step N.M: <Title> with Action, Files,
  Success Criteria, and Planned tests. Then proceed with the workflow above.

Examples
  #exaix-development Plan and implement Phase 134 Step 3.2
  #exaix-development Add input validation to the request handler
  #exaix-development Refactor provider selection to CircuitBreaker pattern
  #exaix-development Security audit for file path handling
````

```
---
exaix:
  skill_id: exaix-development
  triggers:
    keywords: [development, source, tdd, pattern, architecture, implementation]
    task_types: [feature, bugfix, refactor]
    tags: [development]
  constraints:
    - "Write tests first (TDD)"
    - "Use constructor-based DI with I-prefix interfaces"
    - "No magic numbers — use named constants"
    - "No raw SQL in tests"
    - "No Record<string, unknown>"
    - "No import * from"
    - "No console.log for production logging"
    - "All external operations must have timeout protection"
  output_requirements:
    - "Tests written before implementation"
    - "Module-level JSDoc on new files"
    - "check:style, check:arch, check:magic pass"
    - "Planning doc success criteria updated"
  quality_criteria:
    - name: tdd_compliance
      description: Tests written before implementation
      weight: 40
    - name: convention_compliance
      description: Follows Exaix patterns (DI, I-prefix, constants, security)
      weight: 30
    - name: gate_compliance
      description: All CI gates pass
      weight: 30
---
```
