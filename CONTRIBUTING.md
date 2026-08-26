---
title: CONTRIBUTING.md
description: Development workflow and contribution guidelines
agent_priority: medium
copilot_knowledge_base: true
version: 1.3
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

| Hook                          | Purpose                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` (Gate 0)         | Blocks direct commits on `main`                                                                                                                                                                                                                                                                                                                |
| `pre-commit` (numbered gates) | Format, lint, style/boundaries, test placement, magic values, doc/manifest sync, markdown lint, complexity, architecture, docs validation, tool-result parity, event strings, skill/manifest/config checks, and more — see `.git/hooks/pre-commit` for the exact, current list; a fixed gate count here would drift every time a gate is added |
| `pre-push`                    | Regenerate `.copilot/manifest.json` (amends the commit only if it substantively changed), auto-push the `exaix-dev-docs` submodule first if its pointer changed, full type-check (packages/ + apps/ + tests/), security regression tests                                                                                                       |
| `pre-merge-commit`            | Regenerate `.copilot/manifest.json` before merge commits                                                                                                                                                                                                                                                                                       |

The `pre-push` hook is the last gate before code leaves your machine, and it runs in this
order: (1) regenerate `.copilot/manifest.json` — amends the current commit only if the
regenerated manifest substantively changed (a `generated_at` timestamp-only diff is
restored and skipped); (2) if the `exaix-dev-docs` gitlink changed, verify the submodule
has no uncommitted changes and a configured upstream, then push it to its own remote
_before_ the parent repo's commits are sent — this ordering matters, because CI's
`git submodule update` on the parent's new HEAD would fail to resolve a submodule commit
that only exists locally; (3) `deno check packages/ apps/ tests/` to catch type errors in
ALL files (not just `apps/daemon/main.ts`); (4) the `[security]`-filtered regression suite
across `tests/`. There is no "run only the tests for your changed files" step — the type
check and security suite always run in full. If any step fails, the push (including the
submodule push) is blocked.

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

### 4.7 Feature Work in a Separate Worktree (with Submodules)

A second worktree lets you develop a feature in its own directory while
`main` (or any other branch) stays checked out, untouched, in the primary
one — useful for keeping a daemon running on a stable checkout while
iterating elsewhere, or for parallel work on two unrelated features.

#### Create the worktree

`git worktree add <path> <branch>` fails if `<branch>` is already checked
out somewhere else — a branch ref can only be the active checkout in one
worktree at a time, otherwise a commit in one worktree would silently
desync the other's index from the ref it thinks it's on. `main` is
normally checked out in the primary worktree, so add the new one detached
at its tip instead:

```bash
git worktree add --detach ~/git/exaix-feat main
```

**Commits on a detached HEAD have no ref keeping them alive** — switch
away and they become unreachable and eventually gc'd. Turn it into a real
branch before doing any work:

```bash
cd ~/git/exaix-feat
git switch -c feat/<name>
```

#### Submodules: link a worktree of the existing clone instead of re-cloning

`git submodule update --init` inside a new worktree namespaces the
submodule's git-dir correctly (`.git/worktrees/<name>/modules/<submodule>`
as of Git 2.36+), but it is still a **fully independent clone** — its own
object store, no `objects/info/alternates` back to the primary clone. That
costs a redundant network fetch and can hit auth friction the primary
clone doesn't have (this repo's `exaix-dev-docs` submodule is a real
example: `.gitmodules` records an `https://` URL, but only `ssh://` is
authenticated on most workstations, so a fresh `submodule update --init`
fails while the primary clone's manually-repointed `origin` works fine).

Link a worktree of the **existing** submodule clone instead. It shares the
object store, needs no network round-trip, and branches created in either
worktree are visible in the other immediately — worktrees of one repo
share the full ref/object database; only the index and working files
differ per worktree.

```bash
# if `submodule update --init` already made an independent clone, remove it first
git -C ~/git/exaix-feat submodule deinit -f exaix-dev-docs

# create the branch once in the canonical clone (does not touch its current checkout)
git -C ~/git/exaix/exaix-dev-docs branch feat/<name>-docs main

# link it as a worktree — shares objects, zero network cost
git -C ~/git/exaix/exaix-dev-docs worktree add ~/git/exaix-feat/exaix-dev-docs feat/<name>-docs
```

`git -C ~/git/exaix/exaix-dev-docs worktree list` now shows both
directories against the same repo.

#### Commit and push

Use the existing tooling, not raw `git add`/`git commit` — it applies
per-worktree automatically (hooks and gates are repo-level, not
worktree-level):

- Plan-doc step work: `scripts/commit_plan_step.ts` (see the
  `commit`/`submodule-workflow` skills — canonical source
  [`.copilot/skills/submodule-workflow/SKILL.md`](.copilot/skills/submodule-workflow/SKILL.md)).
- Ad-hoc doc/code changes: commit the submodule first, then the parent
  pointer bump, per the same skill.

A **brand-new branch has no upstream yet**, so the pre-push hook's
auto-push-the-submodule step (§4.2) cannot help on the first push of
each — push both manually once, submodule first:

```bash
git -C ~/git/exaix-feat/exaix-dev-docs push -u origin feat/<name>-docs
git -C ~/git/exaix-feat push -u origin feat/<name>
```

After that, plain `git push` works and the pre-push hook's submodule
safety check covers you.

#### Cleanup

```bash
git -C ~/git/exaix/exaix-dev-docs worktree remove ~/git/exaix-feat/exaix-dev-docs
git worktree remove ~/git/exaix-feat
git -C ~/git/exaix/exaix-dev-docs branch -d feat/<name>-docs   # after merge
git branch -d feat/<name>                                       # after merge
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
- [ ] Zod schema updated in `packages/schemas/src/config.ts`.
- [ ] **Type Safety:** No `any`, no `unknown` as stored type, no `as any` casting (see `CODE_STYLE.md` §1).
- [ ] **Dependency Injection:** Injectable services expose an `IFoo` interface; constructors accept `IFoo`, not `Foo`; test mocks implement the full interface (see `CODE_STYLE.md` §5).
- [ ] **Environment Variables:** If using `EXA_LLM_*` vars, validated via `getValidatedEnvOverrides()` (no direct `Deno.env.get()`).
- [ ] **Test Variables:** Test-related env vars use `EXA_TEST_*` prefix and helper functions (`isTestMode()`, `isCIMode()`).
- [ ] Tests added for new configuration options.
- [ ] Documentation updated if behavior changes.

## 6. Architecture

For a comprehensive overview of the system architecture, component interactions, and code organization, please refer to [ARCHITECTURE.md](./ARCHITECTURE.md) in the project root. This document is the ground truth for understanding how Exaix works.
