---
title: "Agent Instructions"
description: Agent coordination and task-specific guidance index
agent_priority: critical
copilot_knowledge_base: true
version: 1.3
capabilities: [task_routing, cross_reference, process_validation]
links:
  - ".copilot/manifest.json"
---

## 🤖 Agent Instructions — Required Reading for All AI Agents

> **⚠️ CRITICAL:** This document and `.copilot/` are **MANDATORY** context for all code tasks.
> _Note: `.copilot/` is the canonical directory. Symlinks like `.claude/`, `.agents/`, `.cursor/`, and `AGENTS.md` exist intentionally to support various agents. They all point to `.copilot/`. For Qwen agents, `.qwen/settings.json` references `.copilot/skills/` directly._
> Read this file first, then use the `.copilot/` documents it points you to as task-specific extensions. If you find a conflict between this file and a `.copilot/` document, or between two `.copilot/` documents, stop and report the conflict instead of guessing.
> A missing topic match in `.copilot/DOCS.md` or `.copilot/manifest.json` is not a conflict; follow the documented fallback path.
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

## ⚠️ START HERE — Pre-Task Checklist

**Before beginning ANY code modification task, you MUST:**

- [ ] Read this file completely
- [ ] Read `## Behavioral Guidelines` (below) — think before coding, simplicity, surgical changes, goal-driven execution
- [ ] Use `.copilot/manifest.json` or `.copilot/DOCS.md` to find relevant `.copilot/` documents by topic, then read all of them before implementation
- [ ] If no matching topic is found in `.copilot/DOCS.md`, fall back to `.copilot/skills/exaix-development/SKILL.md` and note that fallback in your implementation plan
- [ ] If a required document referenced in `.copilot/DOCS.md` is missing on disk, stop and report the missing path instead of inferring its contents
- [ ] If a required document exists on disk but cannot be read or is empty, stop and report: `UNREADABLE: "<path>" exists but could not be read — cannot proceed without resolution.`
- [ ] Read frontmatter of root `.md` files whenever you are selecting which `.copilot/` documents to consult for a task; the first 20 lines identify `copilot_knowledge_base: true` and relevant `capabilities` for that document
- [ ] Read `ARCHITECTURE.md` before modifying any core flow
- [ ] When citing a code location in your response, name the file and the specific symbol (function, class, interface) it concerns — for example `packages/core/src/types.ts:MyServiceConfig` — not just the file
- [ ] **Acknowledge** which `.copilot/` docs guided your approach in your implementation plan

**Example acknowledgment format:**

> "I consulted `.copilot/skills/test-development/SKILL.md` for test patterns and `.copilot/skills/exaix-development/SKILL.md` for source architecture before implementing this feature."

**Failure to consult `.copilot/` documentation is considered a violation of project standards.**

---

## Quick Reference

The full task → doc catalog is auto-generated and always current: **[.copilot/DOCS.md](.copilot/DOCS.md)** (by task type) and **[.copilot/manifest.json](.copilot/manifest.json)** (by topic). Consult those first for anything not in the short list below — a hand-maintained copy of that catalog goes stale silently; this table stays intentionally small so it doesn't.

| Always relevant             | Location                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Behavioral guidelines       | [§ below](#behavioral-guidelines)                                                                                                          |
| Architecture (ground truth) | [ARCHITECTURE.md](./ARCHITECTURE.md)                                                                                                       |
| Coding standards            | [CODE_STYLE.md](./CODE_STYLE.md)                                                                                                           |
| Spec-driven development     | [docs/Exaix_SDD.md](docs/Exaix_SDD.md)                                                                                                     |
| Commit messages             | [.copilot/skills/commit/SKILL.md](.copilot/skills/commit/SKILL.md)                                                                         |
| Plan-driven multi-step work | [.copilot/skills/plan/SKILL.md](.copilot/skills/plan/SKILL.md), [.copilot/skills/next-steps/SKILL.md](.copilot/skills/next-steps/SKILL.md) |
| Active phase plans / status | [exaix-dev-docs/planning/](exaix-dev-docs/planning/)                                                                                       |
| Design analyses & dev specs | [exaix-dev-docs/dev/](exaix-dev-docs/dev/)                                                                                                 |

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
- **Request flow**: `Workspace/Requests/` → `RequestProcessor` → `RequestAnalyzer` → `RequestRouter` → `AgentRunner` → `PlanWriter` → `Workspace/Plans/` (full step-by-component detail: ARCHITECTURE.md § Request Processing Flow)
- **Core storage**: SQLite at `.exa/journal.db` (all activity); filesystem at `Workspace/`, `Portals/`, `Memory/`
- **Architecture invariant**: read the `AGENT_LOGIC` YAML comment in ARCHITECTURE.md's `Request Processing Flow` section before modifying any core flow
- **Boundary rules**: TUI (`apps/tui/src/`) and CLI (`apps/exactl/src/commands/`) must not import directly from services — use interfaces in shared packages under `packages/`
- **Package vs. app placement**: the one-question test (and concrete tells for each side) lives in ARCHITECTURE.md § Packages vs. Services — Placement Model
- **MCP tools**: all agent-accessible tools are listed in [.copilot/docs/TOOLS.md](.copilot/docs/TOOLS.md#agent-tools) and implemented under `packages/mcp/server/` (e.g. `tool_handler.ts`, `domain_tools.ts`)
- **AI providers**: selected via `ProviderSelector` → `CircuitBreaker` → `ProviderFactory`, registered at bootstrap (see ARCHITECTURE.md § AI Provider Architecture for the full provider list and registration paths)
- **Security modes**: Sandboxed (default — no network, no file access) or Hybrid (read-only Portal paths). All production code and test helpers that construct or accept `Workspace/` paths MUST validate them through `PathResolver`; standalone utilities under `scripts/` are exempt only when they never touch workspace paths.
- **Portal code changes**: when writing or modifying code _inside_ a portal (a user project under `Portals/`), apply the secure-by-default checklist in [Blueprints/Skills/security-first.skill.md](Blueprints/Skills/security-first.skill.md) — input validation, path traversal, injection prevention, auth boundaries, secret handling, OWASP 2021.

### Runtime & Tooling

- **Runtime:** Deno (strict TypeScript)
- **Config:** `deno.json` (tasks, imports)
- **Pre-commit / pre-push hooks:** [CONTRIBUTING.md](CONTRIBUTING.md) § 4.2 Hooks has the maintained hook-by-hook summary. Do not hand-copy the gate list here — it will drift silently; `.git/hooks/pre-commit` and `.git/hooks/pre-push` (installed via `deno task hooks:install`) are the executable ground truth.

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

For the full RED → GREEN → REFACTOR workflow, CI gates per phase, and coverage checks, see [.copilot/skills/tdd-workflow/SKILL.md](.copilot/skills/tdd-workflow/SKILL.md).

### Coding Standards

All style rules are consolidated in [CODE_STYLE.md](./CODE_STYLE.md). Please consult that
file for the authoritative, up-to-date guidelines on typing, imports, constants,
DI, environment variables, and related topics.

---

## Task Checklist

Complete this checklist for every implementation task, in order.

### During Implementation

1. For changes that modify behavior, follow TDD: add or update the relevant test first, run it to confirm failure, then implement the minimal fix (see [Development Workflow](#development-workflow) above).
2. Place tests in the owning boundary: package-owned code in `packages/<package>/tests/`, app-owned code in `apps/<app>/tests/`, cross-cutting integration/scenario/security/system checks in root `tests/`. Full placement rules: [.copilot/skills/test-development/SKILL.md](.copilot/skills/test-development/SKILL.md).
3. Do not add new `*_test.ts` files next to source files or under retired legacy test directories.
4. Use established test helpers (`initTestDbService`, `createCliTestContext`, `TestEnvironment.create`, `withEnv`, `MockLLMProvider`, etc.) — see [.copilot/skills/test-development/SKILL.md](.copilot/skills/test-development/SKILL.md) for the full list; do not hand-roll setup a helper already covers.
5. Rerun the failing or behavior-scoped test for the changed slice; if the changed code belongs to a package or app with its own test command, run that next.
6. **Configurable constants:** when adding a new `DEFAULT_*` constant, determine if it is a tunable user-facing default. If yes, wrap it with `configurable()` from `@exaix/core/config` at the definition site — the exported value stays byte-identical. See [CODE_STYLE.md §2](./CODE_STYLE.md#no-magic-values) for required fields and exclusions. Run `deno task check:config-keys` to verify no duplicate keys across all packages.

### Before Claiming Complete

1. Ensure focused `deno check` validation is clean for every touched source/test file;
   expand to the owning package or app only when cross-file type relationships require it.
2. Do not use raw SQL table creation in tests when project helpers already cover the setup.
3. Do not bypass failing checks or ignore pre-commit failures.
4. Do not introduce magic numbers or strings — see [CODE_STYLE.md §2](./CODE_STYLE.md#no-magic-values).
5. Do not place imports anywhere other than the top of the file.
6. Preserve public APIs unless the task explicitly requires a change.
7. Avoid introducing new dependencies unless necessary.
8. Fix source behavior, not tests — never edit or weaken a test just to make it pass unless the test itself is wrong.
9. If you modified any MCP tool handler under `packages/mcp/server/`, run `deno task docs-sync-schemas` and stage the result.
10. Run focused, file-scoped validation after each discrete implementation step, following
    the active task skill's required gates and executing every test written or modified.
11. Before any PR handoff or completion claim, run the applicable focused checks: changed
    tests (including real scenario/E2E execution), lint, type-check, format, and the
    relevant fast repository gates. Do not run `deno run -A scripts/ci.ts all` as a default local check.
    Reserve repository-wide test/coverage runs for massive or cross-cutting changes,
    shared code imported by more than three unrelated packages, an explicit user request,
    or a planning document that explicitly requires repository-wide validation.
12. If you cannot execute required focused validation in the current environment, state
    which checks were skipped and why. A task with skipped required checks must NOT be
    marked complete — mark it `PENDING VERIFICATION` and list the exact commands needed.
13. If a selected validation gate fails, do not claim completion; identify the root cause,
    fix it without bypass flags, and rerun that gate until it passes.

### Local Verification Policy

For normal local work, prefer focused commands such as `deno test --allow-all <changed-test-file>`,
`deno lint <changed-files>`, and `deno check <changed-files>`, plus the task skill's fast
repository gates. This matches [.copilot/skills/next-steps/SKILL.md](.copilot/skills/next-steps/SKILL.md)
and avoids sequential full-suite + coverage runs during a narrow step.

When a repository-wide run is justified by one of the exceptions above, redirect
`deno task test_parallel` output to a temp file to avoid truncation, then search for
failures. Requires `ripgrep` (`rg`); fall back to `grep -E` if unavailable:

```bash
deno task test_parallel > /tmp/test_output.txt 2>&1
rg "FAILED|failed|error" /tmp/test_output.txt   # or: grep -E "FAILED|failed|error" /tmp/test_output.txt
```

Repository-wide CI reference (not the default local verification): `all` and `test` run
the full suite; `all` additionally re-runs it with coverage instrumentation and compiles
all binaries. Leave this expensive cycle to hosted CI unless an exception above applies.
Use `--skip-tests` for a local check+build pass when compilation needs verification:

```bash
deno run -A scripts/ci.ts all                # everything (check + test x2 + build)
deno run -A scripts/ci.ts all --skip-tests    # check + build only — skips Testing and Coverage
deno run -A scripts/ci.ts check               # static analysis only (fast, ~10s)
deno run -A scripts/ci.ts test                # test suite only
deno run -A scripts/ci.ts coverage            # coverage verification only
```

### CI Failure Response Protocol

1. **DO NOT** claim the task is complete.
2. Read the full error output to identify the root cause.
3. Fix the issue (do not bypass checks with `--no-verify` or similar flags).
4. Re-run the failing check to confirm it passes before continuing.

**Common CI failures:**

- **Test failures**: rerun the failing test file with `deno test --allow-all <test-file>` and fix it
- **Complexity breaches**: refactor complex functions (see complexity check output)
- **Duplication**: extract common code into shared utilities
- **Coverage drops**: add tests for uncovered code paths
- **Lint errors**: fix code style issues
- **Type errors**: resolve TypeScript compilation errors

## Project Structure

```text
packages/        # Library packages (@exaix/*): core, AI provider contracts + concrete
                  # providers, CLI/TUI primitives, execution, memory, portal, request,
                  # routing, flow, git, schemas, storage, tool-runtime, quality-gate,
                  # testing, and more.
apps/             # Thin app entry points: daemon, exactl (CLI), mcp-server, tui,
                  # agent-entrypoint, common (shared bootstrap).
tests/            # Integration and scenario tests
.copilot/         # AI assistant guidance (see below)
docs/             # User documentation
ARCHITECTURE.md   # System Architecture & Knowledge Base
```

Package and app names change as the codebase evolves — list them directly (`ls packages/`, `ls apps/`) rather than trusting a hardcoded enumeration here; ARCHITECTURE.md and each package's own README describe what each one does.

## .copilot/ Directory — Your Knowledge Base

The `.copilot/` folder is machine-readable guidance for AI assistants: `manifest.json` (auto-generated doc index), `prompts/` (chat routing wrappers), `skills/` (autonomous workflows), `docs/` (on-demand reference docs). Full structure, role distinction, and maintenance commands: [.copilot/README.md](.copilot/README.md).

For a security audit, go directly to [.copilot/skills/security/SKILL.md](.copilot/skills/security/SKILL.md).

## Current Project Status

Do not rely on inline status in this file. Active phase planning documents live in the `exaix-dev-docs/` submodule at `exaix-dev-docs/planning/` — read that directory for current project state and completion status before starting work. Design analyses, technical specs, and dev-only reference docs (package ownership maps, comparative analyses, edition architecture write-ups) live at `exaix-dev-docs/dev/`. If the submodule is not checked out or a directory is empty, there is no content of that kind currently tracked.
