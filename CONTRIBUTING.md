---
title: CONTRIBUTING.md
description: Development workflow and contribution guidelines
agent_priority: medium
copilot_knowledge_base: true
version: 1.1
capabilities: [pr_workflow, workspace_deployment, regression_testing]
links:
  - "scripts/deploy_workspace.ts"
  - "scripts/ci.ts"
copilot_instructions: .copilot/blueprints/senior-coder.md
---

# Contributing to Exaix

Thank you for your interest in contributing to Exaix! This guide details the development standards, patterns, and workflows to ensure a high-quality, maintainable codebase.

## 1. Coding Standards

All coding conventions and style rules are now maintained in
[CODE_STYLE.md](./CODE_STYLE.md). This document is the single source of truth
for typing, imports, dependency injection, constants, environment variables,
and related topics. Please review it before making any changes to source
code.

(Sections 1.1–1.6 have been removed and relocated to the central guide.)

## 2. Testing

For the full test layout and writing-new-tests guide, see [tests/README.md](./tests/README.md).
For shared test helpers (`@exaix/testing`), see [packages/testing/README.md](./packages/testing/README.md).

### 2.1 Configuration Testing

When adding new configuration options:

- **Unit Tests:** Add tests to `tests/config/config_test.ts` (or equivalent) to verify the option is loaded correctly from TOML.
- **Integration Tests:** Verify that changing the config value actually changes system behavior.

### 2.2 Validation

Before submitting a PR, verify you haven't introduced magic values:

```bash
# Search for potential magic numbers (excluding 0, 1, -1)
grep -rEn --include='*.ts' '([^a-zA-Z_]|^)([2-9][0-9]*|[1-9][0-9]{2,})' packages/ apps/

# Search for potential magic strings (common keywords)
grep -rEn --include='*.ts' '"(ollama|anthropic|openai|pending|active|timeout)"' packages/ apps/
```

## 3. Migration Guide

If you are updating legacy code, refer to `CODE_STYLE.md` §2 (No Magic Numbers or Strings) for the authoritative rules on replacing hardcoded values with the new configuration system.

## 4. AI Agent Development Workflow

### 4.1 Mandatory Pre-Task Steps

**If you are an AI agent (Claude, Copilot, etc.), you MUST:**

1. **Read [`CLAUDE.md`](CLAUDE.md)** for project orientation and quick reference
2. **Read relevant `.copilot/` docs** for your task type:
   - `.copilot/workflows/exaix-development.md` — Source code patterns
   - `.copilot/workflows/testing.md` — Test patterns and helpers
   - `.copilot/workflows/documentation.md` — Documentation guidelines
   - `.copilot/planning/*.md` — Phase planning documents
3. **Cite** which docs guided your approach in your implementation plan

**Example citation:**

> "I consulted `.copilot/workflows/testing.md` for test helpers and `.copilot/workflows/exaix-development.md` for service architecture patterns."

### 4.2 Agent Documentation Index

All available agent documentation is indexed in `.copilot/manifest.json`. Use the quick reference tables in `CLAUDE.md` to find relevant docs for your task.

**Failure to consult `.copilot/` documentation is considered a project standards violation.**

## 5. Safe Git Workflow

### 5.1 Golden Rule: Feature Branches Only

**Never commit directly to `main`.** A pre-commit hook (Gate 0) blocks direct
commits on `main` to protect branch history. Always work on a feature branch:

```bash
git checkout main && git pull --rebase origin main
git checkout -b phase-XX-short-description
```

Bypass (only if intentional): `HOOK_BYPASS_MAIN=1 git commit -m "..."`

### 5.2 Hooks

All hooks are installed by running:

```bash
deno task hooks:install
```

This writes hooks to `.git/hooks/` from `scripts/setup_hooks.ts`. The hooks
are:

| Hook                      | Purpose                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` (Gate 0)     | Blocks direct commits on `main`                                                                                                               |
| `pre-commit` (Gates 1-11) | Format, lint, style, docs, complexity, arch                                                                                                   |
| `pre-push`                | Regenerate `.copilot/manifest.json`, full type-check (packages/ + apps/ + tests/), focused tests for changed files, security regression tests |
| `pre-merge-commit`        | Regenerate `.copilot/manifest.json` before merge commits                                                                                      |

The `pre-push` hook is the last gate before code leaves your machine. It regenerates
`.copilot/manifest.json` before pushing, stages the updated manifest, and amends the
current commit so the regenerated manifest is included in the push. It also runs
`deno check packages/ apps/ tests/` to catch type errors in ALL files (not just `apps/daemon/main.ts`),
runs the test files that correspond to your changes, and always runs security
regression tests. If any of these fail, the push is blocked.

| Hook         | Purpose                               |
| ------------ | ------------------------------------- |
| `pre-rebase` | Blocks rebase with dirty working tree |
| `commit-msg` | Structured commit message validation  |

The `pre-rebase` hook prevents data loss by blocking `git rebase` when the
working tree is dirty. Bypass: `HOOK_BYPASS_REBASE=1 git rebase <target>`

### 5.3 WIP Commits Before Dangerous Operations

Before running `git rebase`, `git pull --rebase`, or `git checkout`:

```bash
git add -A && git commit -m "WIP: save work before rebase"
git rebase origin/main
```

### 5.4 Agent Git State Check

AI agents **MUST** verify git state before multi-step operations:

```bash
git status --porcelain && git rev-parse --abbrev-ref HEAD
```

- If uncommitted changes exist: commit them first with a WIP commit
- If a rebase is in progress: complete or abort it before starting new work
- If on `main`: create a feature branch first

### 5.5 CI Bug Fix Workflow

When CI fails on a PR branch or on `main`:

**PR branch CI failure** — push fixes directly to the feature branch:

```bash
git checkout feature-branch
# fix the issue
git add -A && git commit -m "fix: resolve CI failure"
git push origin feature-branch
```

**Main branch CI failure** — create a hotfix branch:

```bash
git checkout main && git pull --rebase origin main
git checkout -b hotfix/ci-fix main
# fix the issue, verify locally
deno run -A scripts/ci.ts check
git add -A && git commit -m "fix: resolve CI failure in X"
git push origin hotfix/ci-fix
# Open PR, merge via review
```

The pre-commit hook allows **merge commits** on `main` (PR merges are unaffected).
Only direct commits are blocked.

**Emergency bypass** — only when main is broken and immediate fix needed:

```bash
git checkout main && git pull --rebase origin main
# fix the issue
git add -A && HOOK_BYPASS_MAIN=1 git commit -m "fix: emergency CI hotfix for X"
git push origin main
```

### 5.6 Squash Before Merging

Clean up WIP commits before merging to main:

```bash
git rebase -i origin/main
```

## 6. Pull Request Checklist

### 6.1 Commit Message Guidelines

Use Conventional Commits for all changes:

- Format: `<type>(<scope>): <subject>`
- Subject in imperative mood and ≤72 characters
- Include a body for non-trivial changes (what/why, wrapped at 72 chars)
- Reference issues and breaking changes in footer when applicable
- Do not chain multiple `-m` flags; use one multiline commit message (editor or heredoc)

Preferred detailed body format for medium/large changes:

```text
<type>(<scope>): <subject>

Context:
Why this change is necessary.

Changes:
- Key implementation/test/doc change 1
- Key implementation/test/doc change 2

Validation:
- deno check
- deno lint

References:
- Optional issue/plan step/breaking change note
```

Preferred CLI commit invocation:

```bash
git commit -F - <<'COMMIT_MSG'
<type>(<scope>): <subject>

Context:
Why this change is necessary.

Changes:
- Key implementation/test/doc change 1
- Key implementation/test/doc change 2

Validation:
- deno check
- deno lint

References:
- Optional issue/plan step/breaking change note
COMMIT_MSG
```

Authoritative guidance:

- [`.copilot/workflows/commit.md`](.copilot/workflows/commit.md)
- [`Blueprints/Skills/commit-message.skill.md`](Blueprints/Skills/commit-message.skill.md)

- [ ] **(AI Agents)** Consulted relevant `.copilot/` documentation and cited in implementation plan.
- [ ] No new magic numbers or strings introduced.
- [ ] New configuration options added to `exa.config.sample.toml`.
- [ ] Zod schema updated in `packages/core/src/config/schema.ts`.
- [ ] **Type Safety:** No `any`, no `unknown` as stored type, no `as any` casting (see `CODE_STYLE.md` §1).
- [ ] **Dependency Injection:** Injectable services expose an `IFoo` interface; constructors accept `IFoo`, not `Foo`; test mocks implement the full interface (see `CODE_STYLE.md` §5).
- [ ] **Environment Variables:** If using `EXA_LLM_*` vars, validated via `getValidatedEnvOverrides()` (no direct `Deno.env.get()`).
- [ ] **Test Variables:** Test-related env vars use `EXA_TEST_*` prefix and helper functions (`isTestMode()`, `isCIMode()`).
- [ ] Tests added for new configuration options.
- [ ] Documentation updated if behavior changes.
- [ ] All tests pass (`deno task test`).
- [ ] Code formatted (`deno task fmt`).

## 7. Architecture

For a comprehensive overview of the system architecture, component interactions, and code organization, please refer to [ARCHITECTURE.md](./ARCHITECTURE.md) in the project root. This document is the ground truth for understanding how Exaix works.

---

**Footer — Agent Knowledge Base**

- **Copilot Rules**: [.copilot/rules.md](./.copilot/rules.md)
- **Blueprints**: [.copilot/blueprints/](./.copilot/blueprints/)
- **Planning**: [.copilot/planning/](./.copilot/planning/)
- **Manifest**: [.copilot/manifest.json](./.copilot/manifest.json)
