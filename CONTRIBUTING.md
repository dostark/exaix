---
title: CONTRIBUTING.md
description: Development workflow and contribution guidelines
agent_priority: medium
copilot_knowledge_base: true
version: 1.2
capabilities: [pr_workflow, workspace_deployment, regression_testing]
links:
  - "scripts/deploy_workspace.ts"
  - "scripts/ci.ts"
---

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

Before submitting a PR, drive the codebase to a fully green state:

1. **Run the `clean-codebase` skill** to fix all lint, format, style, magic value, complexity, and architecture violations:

   Canonical source: [`.copilot/skills/clean-codebase/SKILL.md`](.copilot/skills/clean-codebase/SKILL.md)

   _Claude Code shorthand: `/clean-codebase`_

2. **Run the full test suite** to confirm nothing is broken:

   ```bash
   deno task test_parallel
   ```

## 3. Migration Guide

If you are updating legacy code, refer to `CODE_STYLE.md` §2 (No Magic Numbers or Strings) for the authoritative rules on replacing hardcoded values with the new configuration system.

## 4. Safe Git Workflow

### 4.1 Golden Rule: Feature Branches Only

**Never commit directly to `main`.** A pre-commit hook (Gate 0) blocks direct
commits on `main` to protect branch history. Always work on a feature branch:

```bash
git checkout main && git pull --rebase origin main
git checkout -b phase-XX-short-description
```

Bypass (only if intentional): `HOOK_BYPASS_MAIN=1 git commit -m "..."`

### 4.2 Hooks

All hooks are installed by running:

```bash
deno task hooks:install
```

This writes hooks to `.git/hooks/` from `scripts/setup_hooks.ts`. The hooks
are:

| Hook                      | Purpose                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` (Gate 0)     | Blocks direct commits on `main`                                                                                                               |
| `pre-commit` (Gates 1-12) | Format, lint, style, docs, complexity, arch, tool-result parity, hallucination bench                                                          |
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

### 4.3 WIP Commits Before Dangerous Operations

Before running `git rebase`, `git pull --rebase`, or `git checkout`:

```bash
git add -A && git commit -m "WIP: save work before rebase"
git rebase origin/main
```

### 4.4 Agent Git State Check

AI agents **MUST** verify git state before multi-step operations:

```bash
git status --porcelain && git rev-parse --abbrev-ref HEAD
```

- If uncommitted changes exist: commit them first with a WIP commit
- If a rebase is in progress: complete or abort it before starting new work
- If on `main`: create a feature branch first

### 4.5 CI Bug Fix Workflow

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

### 4.6 Squash Before Merging

Clean up WIP commits before merging to main:

```bash
git rebase -i origin/main
```

## 5. Pull Request Checklist

### 5.1 Commit Message Guidelines

All commits must use the Exaix structured format. The `commit-msg` hook (`deno task check:commit-msg`) validates every commit automatically.

**Mandatory schema:**

```text
<type>(<scope>): <subject>

what: <detailed explanation of what this commit does>
rationale: <why this change was made>
tests: <which tests were run and their outcome>
who: <agent or developer name>
impact: <ComponentName from ARCHITECTURE.md>: <details>
```

**Optional fields:** `conversation_id:`, `links:`, `prompt:`, `tool_audit:`, `model:`

**Rules:**

- Subject line: imperative mood, ≤72 characters
- Wrap all body text at 72 characters
- The component word before `:` in `impact:` must appear verbatim (case-insensitive) in `what:` — write `what:` first
- Use semicolons in `impact:` only to separate multiple `Component: detail` entries, never to append plain-text clauses

**Example:**

```text
feat(mcp): add tool result parity check

what: Added check-tool-result-parity script to MCP package that validates
  handler output schemas match TOOL_MANIFEST entries.
rationale: Prevents silent schema drift between handler implementations
  and the manifest causing runtime type mismatches.
tests: deno task test_parallel — 142/142 passed
who: Claude
impact: MCP: added parity validation script
```

**Preferred CLI invocation** (heredoc keeps the full body intact):

```bash
git commit -F - <<'EOF'
<type>(<scope>): <subject>

what: ...
rationale: ...
tests: ...
who: ...
impact: ...: ...
EOF
```

For full guidance — batching rules, branch safety, and validator trap details — read the commit skill:

Canonical source: [`.copilot/skills/commit/SKILL.md`](.copilot/skills/commit/SKILL.md)

_Claude Code shorthand: `/commit`_

- [ ] All items in the [AGENTS.md Task Checklist](AGENTS.md#task-checklist) are satisfied.
- [ ] New configuration options added to `exa.config.sample.toml`.
- [ ] Zod schema updated in `packages/core/src/config/schema.ts`.
- [ ] **Type Safety:** No `any`, no `unknown` as stored type, no `as any` casting (see `CODE_STYLE.md` §1).
- [ ] **Dependency Injection:** Injectable services expose an `IFoo` interface; constructors accept `IFoo`, not `Foo`; test mocks implement the full interface (see `CODE_STYLE.md` §5).
- [ ] **Environment Variables:** If using `EXA_LLM_*` vars, validated via `getValidatedEnvOverrides()` (no direct `Deno.env.get()`).
- [ ] **Test Variables:** Test-related env vars use `EXA_TEST_*` prefix and helper functions (`isTestMode()`, `isCIMode()`).
- [ ] Tests added for new configuration options.
- [ ] Documentation updated if behavior changes.

## 6. Architecture

For a comprehensive overview of the system architecture, component interactions, and code organization, please refer to [ARCHITECTURE.md](./ARCHITECTURE.md) in the project root. This document is the ground truth for understanding how Exaix works.
