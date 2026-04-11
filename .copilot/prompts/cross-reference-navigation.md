---
agent: claude
scope: dev
title: "Cross-Reference Navigation Prompt"
short_summary: "Example prompt using cross-reference map for task navigation."
version: "0.1"
topics: ["cross-reference", "navigation", "prompts", "workflow"]
---

**Purpose:**
This document provides a prompt template and usage examples for agents to navigate Exaix's cross-reference map when performing development tasks.

## Prompt Template

```text
I want to [task type].

First, consult `.copilot/cross-reference.md` for the workflow:

1. Find my task type in "Task → Agent Doc Quick Reference"

1.
1.

Task type: [write tests / refactor / update docs / fix errors / add feature / debug / security audit / etc.]

Then proceed with the work following guidance from those docs.
```

---

## Example Usage

### Add New Feature

```text
I want to add a new feature: Flow parameter validation.

First, consult `.copilot/cross-reference.md` for the workflow:

1. Task type: "Add new feature"

1.
1.

Then proceed with:

1. Read Implementation Plan to find/create step

1.
1.
```

---

### Security Audit

````text
I want to perform a security audit on Portal permission boundaries.

First, consult `.copilot/cross-reference.md` for the workflow:

1. Task type: "Security audit"

1.
1.

Then design security tests covering:

- Path traversal attempts (../)
- Symlink escape detection
- Absolute path restrictions
- Cross-portal access attempts

---

### Fix TypeScript Errors

```text
I have TypeScript errors in `src/flows/plan_executor.ts`

First, consult `.copilot/cross-reference.md` for the workflow:

1. Task type: "Fix TypeScript errors"

1.

Read the errors, understand the patterns from `source/exaix.md`, then fix following:

- Service Pattern if it's a service
- Proper error handling
- Type safety throughout

---

### Topic Search

```text
I need help with embeddings and RAG.

Use `.copilot/cross-reference.md` topic search:

- Topic: "embeddings" → `.copilot/providers/claude-rag.md`, `.copilot/README.md`
- Topic: "rag" → `.copilot/providers/claude-rag.md`

Read `claude-rag.md` sections:

- RAG Workflow (4 steps)
- Tools usage (`inspect_embeddings.ts`, `inject_agent_context.ts`)
- Token budget strategies

Then answer my questions about using embeddings.
````

---

## Expected Response Pattern

Agent should:

1. Open and read [.copilot/cross-reference.md](.copilot/cross-reference.md)

1.
1.
1.
1.
1.
