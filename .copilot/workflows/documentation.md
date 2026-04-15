---
agent: copilot
scope: dev
title: Exaix Documentation Development Guidelines
short_summary: "Guidance for producing and maintaining docs in the docs/ directory and cross-referencing the Implementation Plan."
version: "0.1"
topics: ["docs", "process", "publishing"]
---

## Exaix Documentation Development Guidelines (migrated)

## 1. Directory Structure & Role

- **`docs/`**: **Source of Truth for Humans**.
  - Contains User Guides, Architecture Docs, API References, and Security Policies.
  - Target Audience: Users and Developers.

- **`.copilot/`**: **Source of Truth for Agents**.
  - Contains Context, Prompts, Workflows, and structured data (manifests, schemas).
  - Target Audience: AI Agents (Coding Assistants).

> [!IMPORTANT]
> **Agent Strategy:**
>
> - Agents should read `.copilot/` for specific coding patterns, prompts, and workflows.
> - Agents should read `docs/` for high-level architectural understanding.
> - If a conflict exists between `docs/` (human intent) and source code, follow `docs/` but verify with the user.

## Quickstart — Using `.copilot/` with VS Code & Copilot ✅

1. Install Copilot (or open Copilot Labs) in your VS Code.

```bash
# returns JSON with short_summary and snippet for the best doc matching the query
deno run --allow-read scripts/inject_agent_context.ts --query "fix tests" --agent copilot
```

1.

### Copilot Labs / Prompt Template (short)

System: You are a repository-aware coding assistant for Exaix. Before answering, consult the `.copilot/manifest.json` by using the `.copilot/` short_summary and include the matching `short_summary` items. Try to prefer tests-first (TDD) patterns. When suggesting code, add tests.

User: [task details]

### 3. The Living Plan Principle

The `Exaix_Implementation_Plan.md` is not a static roadmap; it is a mutable artifact.

- **Extend on Discovery**: If a task reveals new complexity, add a new sub-step (e.g., `Step 10.3`).
- **Document Before Coding**: Never write code for a feature that isn't in the plan. Write the step first.
- **Structure**: Follow the existing format (Goal, Action items, Success Criteria).

### 4. Style Guide

snippet (Installed in `.vscode/snippets/agent-context.code-snippets`)

- Trigger: "agent-context"
- Inserts a short template reminding Copilot to consult `.copilot/manifest.json` and include short_summary.

## Examples

- "Add unit tests for a service's error handling and implement the minimal change to pass them."
- "Draft a short docs section for adding a new agent doc in `.copilot/` and include sample frontmatter."

## Verification

- Manual: Use `deno run --allow-read scripts/inject_agent_context.ts --query "write tests" --agent copilot` and verify the returned `short_summary` is relevant.
- CI: The `validate-agent-docs` workflow checks doc schema. The `bin/agent-context` / `scripts/inject_agent_context.ts` smoke tests will verify retrieval.

Key points

- Coordinate docs changes with the Implementation Plan and TDD test cases
- Keep version numbers in sync across key docs when required
- Maintain the Terminology Reference and cross-references

Canonical prompt (short):
"You are a documentation assistant for Exaix. Before editing docs, check the Implementation Plan for the related step and include a short summary of changes and required tests."

Examples

- Example prompt: "Update the Testing Strategy doc to include the 'validate-agent-docs' CI workflow. Suggested change snippet: [..]."

Examples section

- Example prompt: "Draft a short 'How-to' section for adding a new agent doc in `.copilot/` following the schema and validation rules."

## Full migration: Documentation guidelines (extended)

### Core Documentation Patterns

- The Refinement Loop: request refinement of Implementation Plan steps before implementing; ensure success criteria are measurable.
- Documentation Cleanup: remove planning artifacts from code; keep history in git and planning docs.

### Test-Driven Documentation

All documentation changes MUST be coordinated with implementation: verify refined Implementation Plan step exists and add TDD test cases when defining new behavior.

### Implementation Plan Structure

Each step MUST include dependencies, rollback, action, justification, TDD test cases, and measurable Success Criteria. Use step status markers (COMPLETED, IN PROGRESS, BLOCKED) to track progress.

### Version Synchronization

Documents that share version numbers MUST be updated together. Add a checklist for updating versions and release dates.

### Terminology Consistency

Maintain a standard Terminology Reference and link to it from major documents. Use consistent capitalization and add new terms to the reference when needed.

### Formatting Standards

- Headers must include version, release date, status, and references
- Use fenced code blocks with language identifiers
- Use consistent table formatting

### Cross-Reference Guidelines

Use relative paths for internal links and include file paths when referencing code. Keep documentation changes minimal and tied to Implementation Plan steps.

---
