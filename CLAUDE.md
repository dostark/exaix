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
copilot_instructions: .copilot/blueprints/senior-coder.md
---

## 🤖 CLAUDE.md — REQUIRED READING FOR ALL AI AGENTS

> **⚠️ CRITICAL:** This document and `.copilot/` are **MANDATORY** context for all code tasks.
> _Note: `.copilot/` is the canonical directory. Symlinks like `.agents/`, `.cursor/`, and `AGENTS.md` exist intentionally to support various agents. They all point to `.copilot/`._
>
> **Violation of these guidelines will result in rejected or incorrect implementations.**

---

## ⚠️ START HERE — Mandatory Pre-Task Checklist

**Before beginning ANY code modification task, you MUST:**

- [ ] Read this `CLAUDE.md` file completely
- [ ] Check `.copilot/cross-reference.md` for task-specific guidance
- [ ] Read at least one relevant `.copilot/` document matching your task type
- [ ] **Acknowledge** which `.copilot/` docs guided your approach in your implementation plan

**Example acknowledgment format:**

> "I consulted `.copilot/tests/testing.md` for test patterns and `.copilot/source/exaix.md` for service architecture before implementing this feature."

**Failure to consult `.copilot/` documentation is considered a violation of project standards.**

---

## 🔍 Context Discovery — Before Making Changes

Before proposing or implementing changes:

1. **Read frontmatter** of root `.md` files — the first 20 lines identify `copilot_knowledge_base: true` and relevant `capabilities` for that document.
2. **Use symbol-based links** (e.g., `packages/core/src/types.ts:Symbol`) when referencing code locations — line numbers shift; symbols stay stable.
3. **Read `ARCHITECTURE.md`** before modifying any core flow — it contains an `AGENT_LOGIC` YAML block that describes expected behavior and invariants.
4. **Run `deno task docs-sync-schemas`** after modifying MCP tool handlers in `packages/mcp/src/handlers/` to keep `TOOLS.md` in sync.

---

## Quick Reference

| Need                 | Location                                                                             |
| -------------------- | ------------------------------------------------------------------------------------ |
| Task → Doc mapping   | [.copilot/cross-reference.md](.copilot/cross-reference.md)                           |
| Source patterns      | [.copilot/guidelines/exaix-development.md](.copilot/guidelines/exaix-development.md) |
| Testing patterns     | [.copilot/guidelines/testing.md](.copilot/guidelines/testing.md)                     |
| Documentation guide  | [.copilot/guidelines/documentation.md](.copilot/guidelines/documentation.md)         |
| Commit skill         | [.copilot/skills/commit/SKILL.md](.copilot/skills/commit/SKILL.md)                   |
| Plan skill           | [.copilot/skills/plan/SKILL.md](.copilot/skills/plan/SKILL.md)                       |
| Next-steps skill     | [.copilot/skills/next-steps/SKILL.md](.copilot/skills/next-steps/SKILL.md)           |
| Slash commands       | [.copilot/prompts/](.copilot/prompts/)                                               |
| Planning documents   | [.copilot/planning/](.copilot/planning/)                                             |
| All agent docs index | [.copilot/manifest.json](.copilot/manifest.json)                                     |

## Project Overview

**Exaix** is an asynchronous, file-based AI agent task automation engine built with **Deno** and **TypeScript**. It processes work requests through a gated pipeline (file → plan → approve → execute → review → merge) rather than interactive chat sessions. This makes it suitable for CI/CD-like workflows where humans set gates and review outputs rather than steering each conversation turn.

### Runtime & Tooling

- **Runtime:** Deno (strict TypeScript)
- **Config:** `deno.json` (tasks, imports)
- **Pre-commit:** Auto-runs gates 1-12 covering format, lint, style, magic, docs, complexity, tool parity, architecture, and more.

### Key Commands

```bash
deno task test              # Run all tests
deno task check:style        # Check code style & boundaries
deno task docs-agent-validate # Verify documentation nervous system integrity
deno task docs-bench          # Run hallucination benchmarks
deno task docs-sync-schemas   # Sync MCP tool schemas to TOOLS.md
```

## Development Workflow

### TDD-First (MANDATORY)

1. Write failing tests first
2. Run the test and confirm it fails
3. Implement the minimum code to make it pass
4. Refactor, keeping tests green

### Coding Standards

All style rules are consolidated in [CODE_STYLE.md](./CODE_STYLE.md). Please consult that
file for the authoritative, up-to-date guidelines on typing, imports, constants,
DI, environment variables, and related topics.

### Before Committing

- Run `deno task test` — all tests must pass
- Run `deno task fmt` — code must be formatted
- Pre-commit hooks enforce: `fmt:check`, `lint`, `check:docs`

### CI Verification (MANDATORY)

**Before claiming any task is complete, you MUST verify all CI checks pass locally.**

#### Quick CI Verification

When running `deno task test_parallel`, always redirect stdout+stderr to a temp file to capture full output without truncation, then search for failures with `rg FAILED\|failed\|error /tmp/test_output.txt`:

```bash
deno task test_parallel > /tmp/test_output.txt 2>&1
rg "FAILED|failed|error" /tmp/test_output.txt
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
# Configure git identity (if needed)
git config user.email "dev@example.com"
git config user.name "Developer"

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

#### CI Success Criteria

A task is only complete when:

- ✅ All tests pass (`deno test --allow-all`)
- ✅ No complexity breaches (threshold: 15)
- ✅ Code duplication < 2%
- ✅ Coverage thresholds met (Line: 60%, Branch: 50%)
- ✅ No lint errors
- ✅ No type errors
- ✅ Architecture validation passes
- ✅ Pre-commit hooks pass

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
docs/            # User documentation (Architecture moved to /ARCHITECTURE.md)
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
├── planning/           # Phase planning documents
└── chunks/             # Pre-chunked docs for RAG (auto-generated)
```

### When to Consult .copilot/

| Task                  | Consult                                                   |
| --------------------- | --------------------------------------------------------- |
| Writing tests         | `.copilot/guidelines/testing.md`                          |
| Adding features       | `.copilot/guidelines/exaix-development.md`                |
| Refactoring           | `.copilot/guidelines/exaix-development.md`                |
| Documentation         | `.copilot/guidelines/documentation.md`                    |
| Commit message        | `.copilot/skills/commit/SKILL.md`                         |
| Planning/roadmap      | `.copilot/skills/plan/SKILL.md`, `.copilot/planning/*.md` |
| Slash commands        | `.copilot/prompts/`                                       |
| Finding the right doc | `.copilot/cross-reference.md`                             |

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
- Always use `PathResolver` to validate paths

### TUI Tests (Important)

- Use `sanitizeOps: false, sanitizeResources: false` for timer-based tests
- Skip `setTimeout` in test mode to avoid timer leaks
- Pattern: `if (Deno.env.get("DENO_TEST") !== "1") setTimeout(...)`

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

> Last updated: 2026-05-01. Check `.copilot/planning/` for the authoritative current state.

### Completed Phases

- **Phase 12:** Obsidian Retirement, Memory Banks v2
- **Phase 13:** TUI Enhancement & Unification (656 tests)
  - All 7 TUI views enhanced with consistent patterns
  - Split view system with layout presets
  - Comprehensive keyboard shortcuts

### Planning Documents

Check `.copilot/planning/` for:

- `phase-12-obsidian-retirement.md`
- `phase-12.5-memory-bank-enhanced.md`
- `phase-13-tui-enhancement.md` ✅ COMPLETED

## Common Workflows

### "Add a new feature"

1. Check `.copilot/planning/` for relevant phase
2. Consult `.copilot/guidelines/exaix-development.md` for patterns
3. Write failing tests first, then implement
4. Run `deno run -A scripts/ci.ts all` before marking complete

### "Fix a bug"

1. Write a failing test that reproduces the bug
2. Fix the root cause (not just the symptom)
3. Confirm the test now passes and no regressions exist

### "Update agent docs"

After adding/changing files in `.copilot/`:

```bash
deno run --allow-read --allow-write scripts/build_agents_index.ts
```

## Mandatory Requirements & Violations

### ⚠️ MANDATORY Requirements

These are **REQUIRED** for all code tasks:

- **MUST** follow TDD (tests first, always)
- **MUST** consult `.copilot/cross-reference.md` to find relevant docs before implementation
- **MUST** read matching `.copilot/` docs and cite them in your plan
- **MUST** use established test helpers (`initTestDbService`, `createCliTestContext`, etc.)
- **MUST** place new tests under the correct `tests/` domain folder; do not add new `*_test.ts` files outside `tests/`, and do not place service tests directly in `tests/services/`
- **MUST** have no TypeScript errors (`deno check packages/ apps/ tests/`) before completing
- **MUST** run `deno task test` before committing
- **MUST** verify all CI checks pass locally before claiming task completion (see CI Verification section)

### 🚫 Violations (Will Result in Rejection)

These actions are **PROHIBITED**:

- ❌ **Skipping tests** — All code must have tests
- ❌ **Proceeding without consulting `.copilot/` docs** — This is a standards violation
- ❌ **Using raw SQL table creation** — Use test helpers
- ❌ **Ignoring pre-commit hook failures** — All checks must pass
- ❌ **Guessing at patterns** — Always check `.copilot/` docs first
- ❌ **Introducing magic numbers/strings** — See `CONTRIBUTING.md`
- ❌ **Placing imports anywhere other than the top of the file** — All imports must be at the top level

---

## Footer — Agent Knowledge Base

- **Copilot Rules**: [.copilot/rules.md](./.copilot/rules.md)
- **Blueprints**: [.copilot/blueprints/](./.copilot/blueprints/)
- **Planning**: [.copilot/planning/](./.copilot/planning/)
- **Manifest**: [.copilot/manifest.json](./.copilot/manifest.json)
