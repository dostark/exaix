---
title: CONTRIBUTING.md
description: Development workflow and contribution guidelines
agent_priority: medium
copilot_knowledge_base: true
version: 1.1
capabilities: [pr_workflow, workspace_deployment, regression_testing]
links:
  - "scripts/deploy_workspace.sh"
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

### 2.1 Configuration Testing

When adding new configuration options:

- **Unit Tests:** Add tests to `tests/config/config_test.ts` (or equivalent) to verify the option is loaded correctly from TOML.
- **Integration Tests:** Verify that changing the config value actually changes system behavior.

### 2.2 Validation

Before submitting a PR, verify you haven't introduced magic values:

```bash
# Search for potential magic numbers (excluding 0, 1, -1)
grep -rEn --include='*.ts' '([^a-zA-Z_]|^)([2-9][0-9]*|[1-9][0-9]{2,})' src/

# Search for potential magic strings (common keywords)
grep -rEn --include='*.ts' '"(ollama|anthropic|openai|pending|active|timeout)"' src/
```

## 3. Migration Guide

If you are updating legacy code, refer to `docs/dev/Migration_Guide_Phase27.md` for detailed instructions on replacing hardcoded values with the new configuration system.

## 4. AI Agent Development Workflow

### 4.1 Mandatory Pre-Task Steps

**If you are an AI agent (Claude, Copilot, etc.), you MUST:**

1. **Read [`CLAUDE.md`](CLAUDE.md)** for project orientation and quick reference

1.
   - `.copilot/source/exaix.md` — Source code patterns
   - `.copilot/tests/testing.md` — Test patterns and helpers
   - `.copilot/docs/documentation.md` — Documentation guidelines
   - `.copilot/planning/*.md` — Phase planning documents
1.

**Example citation:**

> "I consulted `.copilot/tests/testing.md` for test helpers and `.copilot/source/exaix.md` for service architecture patterns."

### 4.2 Agent Documentation Index

All available agent documentation is indexed in `.copilot/manifest.json`. Use the quick reference tables in `CLAUDE.md` to find relevant docs for your task.

**Failure to consult `.copilot/` documentation is considered a project standards violation.**

## 5. Pull Request Checklist

### 5.1 Commit Message Guidelines

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

- [`.copilot/prompts/commit-message.md`](.copilot/prompts/commit-message.md)
- [`Blueprints/Skills/commit-message.skill.md`](Blueprints/Skills/commit-message.skill.md)

- [ ] **(AI Agents)** Consulted relevant `.copilot/` documentation and cited in implementation plan.
- [ ] No new magic numbers or strings introduced.
- [ ] New configuration options added to `exa.config.sample.toml`.
- [ ] Zod schema updated in `src/config/schema.ts`.
- [ ] **Type Safety:** No `any`, no `unknown` as stored type, no `as any` casting (per §1.5).
- [ ] **Dependency Injection:** Injectable services expose an `IFoo` interface; constructors accept `IFoo`, not `Foo`; test mocks implement the full interface (per §1.6).
- [ ] **Environment Variables:** If using `EXA_LLM_*` vars, validated via `getValidatedEnvOverrides()` (no direct `Deno.env.get()`).
- [ ] **Test Variables:** Test-related env vars use `EXA_TEST_*` prefix and helper functions (`isTestMode()`, `isCIMode()`).
- [ ] Tests added for new configuration options.
- [ ] Documentation updated if behavior changes.
- [ ] All tests pass (`deno task test`).
- [ ] Code formatted (`deno task fmt`).

## 6. Architecture

For a comprehensive overview of the system architecture, component interactions, and code organization, please refer to [ARCHITECTURE.md](../ARCHITECTURE.md) in the project root. This document is the ground truth for understanding how Exaix works.

---

**Footer — Agent Knowledge Base**

- **Copilot Rules**: [.copilot/rules.md](./.copilot/rules.md)
- **Blueprints**: [.copilot/blueprints/](./.copilot/blueprints/)
- **Planning**: [.copilot/planning/](./.copilot/planning/)
- **Manifest**: [.copilot/manifest.json](./.copilot/manifest.json)
