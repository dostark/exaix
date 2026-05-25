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
>
> **Conflict reporting format:** State the conflict explicitly in your response in the form: `CONFLICT: "<file-a>" says X, "<file-b>" says Y — cannot proceed without resolution.` Do not attempt to resolve the conflict yourself.
>
> **Violation of these guidelines will result in rejected or incorrect implementations.**

---

## ⚠️ START HERE — Mandatory Pre-Task Checklist

**Before beginning ANY code modification task, you MUST:**

- [ ] Read this `CLAUDE.md` file completely
- [ ] Read `LLM_GUIDE.md` — universal behavioral guidelines (think before coding, simplicity, surgical changes, goal-driven execution)
- [ ] Use `.copilot/cross-reference.md` to identify every required `.copilot/` document for the task type(s) involved, then read all of them before implementation
- [ ] If the task type is not listed in `.copilot/cross-reference.md`, fall back to `.copilot/guidelines/exaix-development.md` and note that fallback in your implementation plan
- [ ] If a required document listed in `.copilot/cross-reference.md` is missing on disk, stop and report the missing path instead of inferring its contents
- [ ] Read frontmatter of root `.md` files when relevant; the first 20 lines identify `copilot_knowledge_base: true` and relevant `capabilities` for that document
- [ ] Read `ARCHITECTURE.md` before modifying any core flow
- [ ] Use symbol-based links (for example `packages/core/src/types.ts:MyServiceConfig`) when referencing code locations
- [ ] Identify your LLM provider and read the matching file in `.copilot/providers/` before starting (available: `claude.md`, `openai.md`, `google.md`, `google-long-context.md`). If no file exists for your provider, skip this step.
- [ ] **Acknowledge** which `.copilot/` docs guided your approach in your implementation plan

**Example acknowledgment format:**

> "I consulted `.copilot/guidelines/testing.md` for test patterns and `.copilot/guidelines/exaix-development.md` for source architecture before implementing this feature."

**Failure to consult `.copilot/` documentation is considered a violation of project standards.**

---

## Quick Reference

| Need                      | Location                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Behavioral guidelines     | [LLM_GUIDE.md](./LLM_GUIDE.md)                                                       |
| Task → Doc mapping        | [.copilot/cross-reference.md](.copilot/cross-reference.md)                           |
| Source patterns           | [.copilot/guidelines/exaix-development.md](.copilot/guidelines/exaix-development.md) |
| Testing patterns          | [.copilot/guidelines/testing.md](.copilot/guidelines/testing.md)                     |
| Documentation guide       | [.copilot/guidelines/documentation.md](.copilot/guidelines/documentation.md)         |
| Coding standards          | [CODE_STYLE.md](./CODE_STYLE.md)                                                     |
| Magic numbers / constants | [CODE_STYLE.md](./CODE_STYLE.md) §2                                                  |
| MCP tool index            | [TOOLS.md](./TOOLS.md)                                                               |
| Provider-specific notes   | [.copilot/providers/](.copilot/providers/)                                           |
| Commit skill              | [.copilot/skills/commit/SKILL.md](.copilot/skills/commit/SKILL.md)                   |
| Plan skill                | [.copilot/skills/plan/SKILL.md](.copilot/skills/plan/SKILL.md)                       |
| Next-steps skill          | [.copilot/skills/next-steps/SKILL.md](.copilot/skills/next-steps/SKILL.md)           |
| Slash commands            | [.copilot/prompts/](.copilot/prompts/)                                               |
| Planning documents        | [exaix-dev-docs/planning/](exaix-dev-docs/planning/)                                 |
| All agent docs index      | [.copilot/manifest.json](.copilot/manifest.json)                                     |

## Project Overview

**Exaix** is an asynchronous, file-based AI agent task automation engine built with **Deno** and **TypeScript**. It processes work requests through a gated pipeline (file → plan → approve → execute → review → merge) rather than interactive chat sessions. This makes it suitable for CI/CD-like workflows where humans set gates and review outputs rather than steering each conversation turn.

### Runtime & Tooling

- **Runtime:** Deno (strict TypeScript)
- **Config:** `deno.json` (tasks, imports)
- **Pre-commit:** Auto-runs gates 0-12. Gate 0 blocks direct commits to `main`. Gates 1-12:

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

A **behavior change** is any edit that affects runtime output, observable state, or what an existing test asserts — as opposed to comments, documentation, formatting, or config-only changes that alter no executed code path.

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

Use the **Task Checklist** below before claiming the task is complete or creating a commit.

## Task Checklist

Use this as the single canonical checklist for code tasks:

1. DURING: For changes that modify behavior, follow TDD by adding or updating the relevant test first, running it to confirm failure, then implementing the minimal fix.
2. DURING: Place tests in the owning boundary: package-owned code goes in `packages/<package>/tests/`, app-owned code goes in `apps/<app>/tests/`, and cross-cutting integration, scenario, security, and system checks stay in root `tests/`.
3. DURING: Do not add new `*_test.ts` files next to source files or under retired legacy test directories.
4. DURING: Use established test helpers (`initTestDbService`, `createCliTestContext`, etc.) when project helpers already cover the setup.
5. DURING: Rerun the failing or behavior-scoped test for the changed slice; if the changed code belongs to a package or app with its own test command, run that package- or app-scoped test command next.
6. DONE: Ensure `deno check packages/ apps/ tests/` is clean before finishing.
7. DONE: Complete the CI Verification section below before claiming the task is complete.
8. DONE: Do not use raw SQL table creation in tests when project helpers already cover the setup.
9. DONE: Do not bypass failing checks or ignore pre-commit failures.
10. DONE: Do not introduce magic numbers or strings without following project guidance in `CONTRIBUTING.md`.
11. DONE: Do not place imports anywhere other than the top of the file.
12. DONE: If you modified any MCP tool handler in `packages/mcp/src/handlers/`, run `deno task docs-sync-schemas` and stage the result.

### CI Verification (MANDATORY)

**Before claiming any task is complete, you MUST verify all CI checks pass locally.**

This section expands Task Checklist item 7. Follow these steps in order:

1. After each discrete implementation step, run the quick verification command below.
2. Before any PR handoff or completion claim, run `deno run -A scripts/ci.ts all`.
3. If `deno run -A scripts/ci.ts all` fails without a clear cause, use the Manual CI Workflow Verification steps below.
4. If you cannot execute shell commands in the current environment, state which validation steps were skipped, why they were skipped, and that the task remains unverified.

#### Quick CI Verification

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

#### Manual CI Workflow Verification

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

#### CI Failure Response Protocol

**If CI fails:**

1. **DO NOT** claim the task is complete
2. Read the full error output to identify the root cause
3. Fix the issue (do not bypass checks with `--no-verify` or similar flags)
4. Re-run the failing check to confirm it passes before continuing

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
├── guidelines/         # Reference guidelines and process documents
├── providers/          # Provider-specific guidance (Claude, OpenAI, Google)
├── planning/           # (reserved — active phase docs live in exaix-dev-docs/planning/)
└── chunks/             # Pre-chunked docs for RAG (auto-generated)
```

### When to Consult .copilot/

> For the full task→doc map, use the **Quick Reference** table at the top of this file. The rows below cover `.copilot/`-specific lookups not listed there.

| Task              | Consult                                                 |
| ----------------- | ------------------------------------------------------- |
| Security audit    | `.copilot/skills/security/SKILL.md`                     |
| Provider-specific | `.copilot/providers/` (claude.md, openai.md, google.md) |

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

### TUI Tests

> For general test placement and helper conventions see `.copilot/guidelines/testing.md`. The rules below are TUI-specific additions to that guideline.

- Place TUI tests in the owning package or app test directory (`packages/tui/tests/`, `apps/tui/tests/`), not next to source files.
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
