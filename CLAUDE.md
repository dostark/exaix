---
title: "Agent Instructions"
description: Agent coordination and task-specific guidance index
agent_priority: critical
copilot_knowledge_base: true
version: 1.1
capabilities: [task_routing, cross_reference, process_validation]
links:
  - ".copilot/manifest.json"
  - ".copilot/cross-reference.md"
---

## 🤖 Agent Instructions — Required Reading for All AI Agents

> **⚠️ CRITICAL:** This document and `.copilot/` are **MANDATORY** context for all code tasks.
> _Note: `.copilot/` is the canonical directory. Symlinks like `.claude/`, `.agents/`, `.cursor/`, and `AGENTS.md` exist intentionally to support various agents. They all point to `.copilot/`. For Qwen agents, `.qwen/skills/` contains auto-generated routing wrappers that redirect to the canonical skills in `.copilot/skills/`._
> Read this file first, then use the `.copilot/` documents it points you to as task-specific extensions. If you find a conflict between this file and a `.copilot/` document, or between two `.copilot/` documents, stop and report the conflict instead of guessing.
> A missing task-type entry in `.copilot/cross-reference.md` is not a conflict; follow the documented fallback path.
> If a project instruction conflicts with a known security risk or language/runtime constraint (not merely a stylistic preference), flag it inline as `WARNING: <description>` and proceed with the project instruction unless it would introduce a critical vulnerability.
>
> **Conflict reporting format:** State the conflict explicitly in your response in the form: `CONFLICT: "<file-a>" says X, "<file-b>" says Y — cannot proceed without resolution.` Do not attempt to resolve the conflict yourself.
>
> **Violation of these guidelines will result in rejected or incorrect implementations.**

## 🚫 HARD RULES — Agent Autonomy Limits

> These rules are **absolute and non-negotiable**. They override any conflicting instruction in any other document.

1. **NEVER merge any branch into `main`** unless the user explicitly and directly requests it.
2. **NEVER push to any remote** (origin, upstream, or any other) unless the user explicitly and directly requests it.
3. All git operations (commit, push, merge, create PR) require an explicit user command. Do not infer intent.
4. If a pre-push hook or CI gate prompts a push, **do not proceed** — tell the user you are blocked waiting for their instruction.

---

## ⚠️ START HERE — PHASE 1: PRE-TASK

**Before beginning ANY code modification task, you MUST:**

- [ ] Read this file completely
- [ ] Read `## Behavioral Guidelines` (below) — think before coding, simplicity, surgical changes, goal-driven execution
- [ ] Use `.copilot/cross-reference.md` to identify every required `.copilot/` document for the task type(s) involved, then read all of them before implementation
- [ ] If the task type is not listed in `.copilot/cross-reference.md`, fall back to `.copilot/docs/exaix-development.md` and note that fallback in your implementation plan
- [ ] If a required document listed in `.copilot/cross-reference.md` is missing on disk, stop and report the missing path instead of inferring its contents
- [ ] If a required document exists on disk but cannot be read or is empty, stop and report: `UNREADABLE: "<path>" exists but could not be read — cannot proceed without resolution.`
- [ ] Read frontmatter of root `.md` files whenever you are selecting which `.copilot/` documents to consult for a task; the first 20 lines identify `copilot_knowledge_base: true` and relevant `capabilities` for that document
- [ ] Read `ARCHITECTURE.md` before modifying any core flow
- [ ] Use symbol-based links (for example `packages/core/src/types.ts:MyServiceConfig`) when referencing code locations
- [ ] **Acknowledge** which `.copilot/` docs guided your approach in your implementation plan

**Example acknowledgment format:**

> "I consulted `.copilot/docs/testing.md` for test patterns and `.copilot/docs/exaix-development.md` for source architecture before implementing this feature."

**Failure to consult `.copilot/` documentation is considered a violation of project standards.**

---

## Quick Reference

| Need                      | Location                                                                   |
| ------------------------- | -------------------------------------------------------------------------- |
| Behavioral guidelines     | [CLAUDE.md](./CLAUDE.md#behavioral-guidelines)                             |
| Task → Doc mapping        | [.copilot/cross-reference.md](.copilot/cross-reference.md)                 |
| Source patterns           | [.copilot/docs/exaix-development.md](.copilot/docs/exaix-development.md)   |
| Testing patterns          | [.copilot/docs/testing.md](.copilot/docs/testing.md)                       |
| Documentation guide       | [.copilot/docs/documentation.md](.copilot/docs/documentation.md)           |
| Coding standards          | [CODE_STYLE.md](./CODE_STYLE.md)                                           |
| Magic numbers / constants | [CODE_STYLE.md](./CODE_STYLE.md) §2                                        |
| MCP tool index            | [.copilot/docs/TOOLS.md](.copilot/docs/TOOLS.md)                           |
| Commit skill              | [.copilot/skills/commit/SKILL.md](.copilot/skills/commit/SKILL.md)         |
| Plan skill                | [.copilot/skills/plan/SKILL.md](.copilot/skills/plan/SKILL.md)             |
| Next-steps skill          | [.copilot/skills/next-steps/SKILL.md](.copilot/skills/next-steps/SKILL.md) |
| Slash commands            | [.copilot/prompts/](.copilot/prompts/)                                     |
| Planning documents        | [exaix-dev-docs/planning/](exaix-dev-docs/planning/)                       |
| All agent docs index      | [.copilot/manifest.json](.copilot/manifest.json)                           |

## Behavioral Guidelines

Four universal rules to reduce common LLM coding mistakes. These bias toward caution over speed; for trivial tasks, use judgment.

### 1. Think Before Coding

Before implementing: state assumptions, surface tradeoffs, and ask when uncertain. If multiple interpretations exist, present them — don't pick silently. If a simpler approach exists, say so.

### 2. Simplicity First

Minimum code that solves the problem. Nothing speculative. No features beyond what was asked, no abstractions for single-use code, no "flexibility" that wasn't requested. If 200 lines can be 50, rewrite it.

### 3. Surgical Changes

Touch only what you must. Don't "improve" adjacent code, comments, or formatting. Don't refactor things that aren't broken. Match existing style even if you'd do it differently.

### 4. Goal-Driven Execution

Ask "what exactly am I being asked to deliver?" before starting. Build exactly that. Don't deliver a solution to a problem no one asked about. If scope creeps, flag it — don't implement it.

## Agent Quick Facts

Key facts about the Exaix system:

- **Entry point**: `apps/daemon/main.ts` — starts the daemon, wires all services
- **Request flow**: `Workspace/Requests/` → `RequestProcessor` → `RequestAnalyzer` → `RequestRouter` → `AgentRunner` → `PlanWriter` → `Workspace/Plans/`
- **Core storage**: SQLite at `.exa/journal.db` (all activity); filesystem at `Workspace/`, `Portals/`, `Memory/`
- **AI providers**: concrete providers live in `@exaix/ai-anthropic`, `@exaix/ai-openai`, `@exaix/ai-google`, `@exaix-team/ai-vertex`, `@exaix/ai-openrouter`, `@exaix/ai-ollama`; selected via `ProviderSelector` → `CircuitBreaker` → `ProviderFactory`; registered at bootstrap by `apps/common/registry_bootstrap.ts`
- **Architecture invariant**: read the `AGENT_LOGIC` YAML comment in ARCHITECTURE.md's `Request Processing Flow` section before modifying any core flow
- **Boundary rules**: TUI (`apps/tui/src/`) and CLI (`apps/exactl/src/commands/`) must not import directly from services — use interfaces in shared packages under `packages/`
- **MCP tools**: all agent-accessible tools are listed in [.copilot/docs/TOOLS.md](.copilot/docs/TOOLS.md#agent-tools) and implemented under `packages/mcp/server/` (e.g. `tool_handler.ts`, `domain_tools.ts`)

### Runtime & Tooling

- **Runtime:** Deno (strict TypeScript)
- **Config:** `deno.json` (tasks, imports)
- **Pre-commit:** Auto-runs gates 0-13. Gate 0 blocks direct commits to `main`. Gates 1-13:

  | Gate | Check               | Task                                           |
  | ---- | ------------------- | ---------------------------------------------- |
  | 1    | Format              | `deno task fmt:check`                          |
  | 2    | Lint                | `deno task lint`                               |
  | 3    | Style / boundaries  | `deno task check:style`                        |
  | 4    | Test placement      | `deno task check:test-placement`               |
  | 5    | Magic values        | `deno task check:magic`                        |
  | 6    | Manifest auto-sync  | `scripts/build_agents_index.ts` + `check:docs` |
  | 7    | Markdown lint       | `scripts/markdown_lint.ts` (staged `.md` only) |
  | 8    | Complexity          | `deno task check:complexity`                   |
  | 9    | Tool-result parity  | `deno task check:tool-result-parity`           |
  | 10   | Architecture        | `deno task check:arch`                         |
  | 11   | Docs nervous system | `deno task docs-agent-validate`                |
  | 12   | Hallucination bench | `deno task docs-bench`                         |
  | 13   | Event strings       | `deno task check:event-strings`                |
  | 14   | Optional params     | `deno task check:optional-params --fail`       |
  | 15   | Markdown paths      | `deno task check:md-path:staged`               |

> Gate 12 (`docs-bench`, filter `[hallucination-bench]`) also runs `tests/docs/positioning_consistency_test.ts`, which enforces Phase 91's positioning/glossary/weaknesses cross-document consistency (no-vaporware phase claims, three-tier narrative, differentiation material, GLOSSARY.md split, stale-path regressions).

### Key Commands

```bash
deno task test              # Run all tests
deno task check:style        # Check code style & boundaries
deno task docs-agent-validate # Verify documentation nervous system integrity
deno task docs-bench          # Run hallucination benchmarks
deno task docs-sync-schemas   # Sync MCP tool schemas to TOOLS.md
```

## Development Workflow

### TDD-First For Behavior Changes (MANDATORY)

A **behavior change** is any edit that affects runtime output, observable state, or what an existing test asserts — as opposed to comments, documentation, formatting, or config-only changes that alter no executed code path. Config-only changes qualify as non-behavior changes only when the changed values are never read by executed code paths (for example, editor settings or CI metadata). Changes to runtime-read config values such as thresholds or feature flags are behavior changes and require TDD.

For changes that modify behavior:

1. Write failing tests first
2. Run the test and confirm it fails
3. Implement the minimum code to make it pass
4. Refactor, keeping tests green

### Coding Standards

All style rules are consolidated in [CODE_STYLE.md](./CODE_STYLE.md). Please consult that
file for the authoritative, up-to-date guidelines on typing, imports, constants,
DI, environment variables, and related topics.

### Before Committing

Use the phase checklists below before claiming the task is complete or creating a commit.

## PHASE 2: DURING IMPLEMENTATION

Use this checklist while implementing:

1. For changes that modify behavior, follow TDD by adding or updating the relevant test first, running it to confirm failure, then implementing the minimal fix.
2. Place tests in the owning boundary: package-owned code goes in `packages/<package>/tests/`, app-owned code goes in `apps/<app>/tests/`, and cross-cutting integration, scenario, security, and system checks stay in root `tests/`.
3. Do not add new `*_test.ts` files next to source files or under retired legacy test directories.
4. Use established test helpers (`initTestDbService`, `createCliTestContext`, etc.) when project helpers already cover the setup.
5. Rerun the failing or behavior-scoped test for the changed slice; if the changed code belongs to a package or app with its own test command, run that package- or app-scoped test command next.

## PHASE 3: DONE / CI

Complete this sequence in order before claiming any task is complete:

1. Ensure `deno check packages/ apps/ tests/` is clean before finishing.
2. Do not use raw SQL table creation in tests when project helpers already cover the setup.
3. Do not bypass failing checks or ignore pre-commit failures.
4. Do not introduce magic numbers or strings without following project guidance in `CONTRIBUTING.md`.
5. Do not place imports anywhere other than the top of the file.
6. If you modified any MCP tool handler under `packages/mcp/server/`, run `deno task docs-sync-schemas` and stage the result.
7. After each discrete implementation step, run the quick verification command below.
8. Before any PR handoff or completion claim, run `deno run -A scripts/ci.ts all`.
9. If `deno run -A scripts/ci.ts all` fails without a clear cause, run the manual workflow commands listed below to replicate CI behavior.
10. If you cannot execute shell commands in the current environment, state which validation steps were skipped, why they were skipped, and that the task remains unverified. A task with skipped CI steps must NOT be marked complete. Mark it as `PENDING VERIFICATION` and list the exact commands a human reviewer must run to close it.
11. If CI fails, do not claim completion; identify the root cause, fix it without bypass flags, and rerun the failing check until it passes.

### Quick CI Verification

When running `deno task test_parallel`, always redirect stdout+stderr to a temp file to capture full output without truncation, then search for failures. Requires `ripgrep` (`rg`); fall back to `grep -E` if unavailable:

```bash
deno task test_parallel > /tmp/test_output.txt 2>&1
rg "FAILED|failed|error" /tmp/test_output.txt   # or: grep -E "FAILED|failed|error" /tmp/test_output.txt
```

Run the unified CI script to verify all checks:

```bash
# Full CI pipeline (recommended before PR)
deno run -A scripts/ci.ts all

# Individual checks
deno run -A scripts/ci.ts check    # Static analysis
deno run -A scripts/ci.ts test     # Test suite
deno run -A scripts/ci.ts coverage # Coverage verification
```

### Manual CI Workflow Verification

To replicate exact CI behavior, run the workflows locally:

**1. Code Quality Gates** (`.github/workflows/code-quality.yml`):

```bash
# Format check
deno fmt --check

# Lint check
deno lint

# Code duplication check
deno run --allow-run --allow-read --allow-write scripts/measure_duplication.ts --threshold 2.0

# Complexity check
deno run --allow-read --allow-net scripts/measure_complexity.ts --threshold 15 --json > complexity.json
deno run --allow-read scripts/check_complexity_breaches.ts

# Test & Coverage
deno run --allow-run --allow-read --allow-write scripts/measure_coverage.ts

# Build verification
deno check packages/ apps/ tests/

# Architecture validation
deno task check:arch
```

**2. PR Validation** (`.github/workflows/pr-validation.yml`):

```bash
# Configure git identity (if needed — use --local to avoid mutating global config)
git config --local user.email "dev@example.com"
git config --local user.name "Developer"

# Run checks
deno run -A scripts/ci.ts check

# Run tests
deno run -A scripts/ci.ts test --quick
```

### CI Failure Response Protocol

If CI fails, follow this sequence:

1. **DO NOT** claim the task is complete.
2. Read the full error output to identify the root cause.
3. Fix the issue (do not bypass checks with `--no-verify` or similar flags).
4. Re-run the failing check to confirm it passes before continuing.

**Common CI Failures:**

- **Test failures**: Run `deno test --allow-all` and fix failing tests
- **Complexity breaches**: Refactor complex functions (see complexity check output)
- **Duplication**: Extract common code into shared utilities
- **Coverage drops**: Add tests for uncovered code paths
- **Lint errors**: Fix code style issues
- **Type errors**: Resolve TypeScript compilation errors

## Project Structure

```text
packages/        # Library packages (@exaix/*)
├── core/        # Core contracts, config, utilities
├── ai/          # LLM provider contracts and shared utilities
├── ai-*/        # Concrete provider packages (anthropic, openai, google, ollama)
├── cli/         # Base CLI types, formatters, helpers
├── tui/         # Base TUI components and layout
├── mcp/         # MCP manifest, server runtime
├── execution/   # Agent orchestration
├── memory/      # Memory bank, extraction, embedding
├── portal/      # Portal analysis, permissions, persistence
├── request/     # Request parsing, routing, processing
├── routing/     # Routing policy, capability matching
├── flow/        # Flow persistence, checkpoint, validator
├── git/         # Git service
├── schemas/     # Zod validation schemas
├── storage-sqlite/ # SQLite database implementation
├── tool-runtime/   # ToolRegistry, OutputValidator, path security
├── quality-gate/   # Quality evaluation, LLM assessment
└── testing/     # Shared test helpers and fixtures

apps/            # Thin app entry points
├── daemon/      # Daemon entry point (main.ts)
├── exactl/      # CLI app (concrete commands, handlers)
├── mcp-server/  # MCP server entry point
└── tui/         # TUI app (concrete dashboards, views)

tests/           # Integration and scenario tests
.copilot/        # AI assistant guidance (see below)
docs/            # User documentation
ARCHITECTURE.md  # System Architecture & Knowledge Base
```

## .copilot/ Directory — Your Knowledge Base

The `.copilot/` folder contains **machine-readable guidance** for AI assistants:

### Structure

```text
.copilot/
├── manifest.json       # Index of all agent docs (auto-generated)
├── cross-reference.md  # Task → Document quick reference
├── prompts/            # Chat routing wrappers — one .prompt.md per skill
├── skills/             # Multi-step autonomous skills (SKILL.md per skill)
├── docs/               # On-demand reference documents (agent-oriented)
├── planning/           # (reserved — active phase docs live in exaix-dev-docs/planning/)
└── chunks/             # Pre-chunked docs for RAG (auto-generated)
```

### When to Consult .copilot/

> For the full task→doc map, use the **Quick Reference** table at the top of this file. The rows below cover `.copilot/`-specific lookups not listed there.

| Task           | Consult                             |
| -------------- | ----------------------------------- |
| Security audit | `.copilot/skills/security/SKILL.md` |

## Key Patterns & Constraints

### Service Pattern

- Constructor-based DI: pass `config`, `db`, `provider`
- Keep side effects out of constructors

### File System as Database

- `Workspace/Active`, `Workspace/Requests`, `Workspace/Plans` are the "database"
- Use atomic file operations (write + rename)
- All side-effects MUST log to Activity Journal via `EventLogger`

### Security Modes

- **Sandboxed:** No network, no file access (default)
- **Hybrid:** Read-only access to Portal paths
- Workspace paths are file-system paths under `Workspace/` such as `Workspace/Active`, `Workspace/Requests`, `Workspace/Plans`, and their subdirectories.
- All production code and test helpers that construct or accept workspace paths must validate them through `PathResolver`; standalone utilities under `scripts/` are exempt only when they do not access workspace paths.
- When writing or modifying code **inside a portal** (user project), apply the secure-by-default practices in [`Blueprints/Skills/security-first.skill.md`](Blueprints/Skills/security-first.skill.md): input validation, path traversal, injection prevention, auth boundaries, secret handling, and the OWASP 2021 checklist.

### Package vs App Placement

**The placement test — one question:** _Can an external consumer use this module without knowing the Exaix daemon exists?_

- **Yes** → it belongs in a package under `packages/`.
- **No** → it belongs in `apps/` (runtime wiring).

An `apps/` or runtime-wiring module orchestrates the running Exaix process. It coordinates multiple packages and runtime concerns: `Config`, `DatabaseService`, `EventLogger`, file-system state, process lifecycle. It wires packages together into coherent business flows, bootstrapped in `apps/daemon/main.ts` and `apps/exactl/src/init.ts`.

**Common tells that a module belongs in a package:**

- It has no `Config`, `DatabaseService`, or `EventLogger` in its constructor.
- Its tests use only in-memory stubs or temp directories — no `initTestDbService()`.
- Another package already imports it (or would need to, for type correctness).
- Its domain logic would be equally valid in a different application.

**Common tells that a module belongs in `apps/` (runtime wiring):**

- It instantiates or receives a `DatabaseService` to persist state.
- It emits events via `EventLogger` as part of its contract.
- It reads from `Config` to determine runtime behaviour (paths, thresholds, feature flags).
- It coordinates two or more packages — it is glue, not logic.
- Removing it would break daemon startup or the request-processing pipeline directly.

### Test Guidance

> For full test placement and helper conventions see `.copilot/docs/testing.md`. The rules below apply across all test types.

- Place tests in the owning boundary: package-owned tests in `packages/<package>/tests/`, app-owned tests in `apps/<app>/tests/`, and cross-cutting integration/scenario/security/system tests in root `tests/`.
- Do not place new tests next to source files unless the project testing guideline explicitly requires it.
- Use `sanitizeOps: false, sanitizeResources: false` for timer-based tests.
- Skip `setTimeout` in test mode to avoid timer leaks — pattern: `if (Deno.env.get("DENO_TEST") !== "1") setTimeout(...)`

## Test Helpers

```typescript
// Database + tempdir setup
const { db, tempDir, cleanup } = await initTestDbService();

// CLI test context
const ctx = await createCliTestContext();

// Full integration environment
const env = await TestEnvironment.create();

// Temporary env vars
await withEnv({ MY_VAR: "value" }, async () => { ... });
```

## Current Project Status

Do not rely on inline status in this file. Active phase planning documents live in the `exaix-dev-docs/` submodule at `exaix-dev-docs/planning/`. Read that directory for current project state and completion status before starting work. If the submodule is not checked out or the directory is empty, there are no active phases in progress.

## Common Workflows

For all task types, complete the pre-task checklist first and finish by satisfying the Task Checklist. After adding or changing files in `.copilot/`, you can preview the manifest update before staging:

```bash
deno run --allow-read --allow-write scripts/build_agents_index.ts
```

> Note: Gate 6 auto-runs this script and stages the result on every commit when `.copilot/` sources are staged — so the manual run above is only needed to preview changes before committing.
