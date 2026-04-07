---
agent: general
scope: dev
title: "Exaix Agent Prompt Templates Library"
short_summary: "Comprehensive library of prompt templates for systematic coding agent workflows in Exaix."
version: "0.1"
topics: ["prompts", "templates", "agents", "workflows", "best-practices"]
---

Welcome to the Exaix prompt template library for coding agents. This collection enables agents to systematically wrap raw user prompts with advanced, context-rich instructions, ensuring clarity, completeness, and best practices for all coding tasks in the Exaix codebase.

These templates are the canonical Exaix workflow prompts. They are distinct from the slash-command wrappers in `../../.github/prompts/`, which exist for GitHub/Copilot editor integrations.

## How It Works

- **Template Selection:** For each raw user prompt, the agent selects the most suitable template (see aliases below).
- **Prompt Embedding:** The agent embeds the raw prompt into the body of the chosen template, following all instructions and requirements.
- **Best Practices:** Each template enforces Exaix standards: TDD, regression tests, linting, success criteria, and more.
- **Aliases:** Use the alias (e.g. `#plan`, `@fix`, `#step`) in your prompt to suggest a template, or let the agent auto-select.

## Why Use Templates

- **Consistency:** Ensures all requests are clear, systematic, and actionable.
- **Completeness:** Reminds agents to include tests, criteria, and validation steps.
- **Professionalism:** Moves from amateur prompting to advanced, reliable agent workflows.

## Template Aliases

- `#plan` — Feature Planning
- `#step` — Implement Feature Step
- `#fix` — Bug/Test Fix
- `#refactor` — Refactoring
- `#doc` — Documentation
- `#review` — Code Review
- `#test` — Test Creation
- `#infra` — Infrastructure/Config
- `#regression` — Regression Test
- `#lint` — Linting/Formatting
- `#security` — Security Patch
- `#upgrade` — Dependency/Version Upgrade
- `#explore` — Codebase Exploration
- `#duplication` — Code Duplication Reduction
- `#commit` — Detailed Commit Message
- `#pre-gap-analysis` — Pre-implementation gap analysis of a planning document
- `#post-gap-analysis` — Deep post-implementation review of a planning document
- `#next-steps` — TDD Red-Green-Refactor Phase Steps (plan-driven, CI-gated, per-step commits)

## Usage Example

> "#plan Add OAuth2 login support"

The agent will wrap your raw prompt with the `plan` template, ensuring all planning best practices are followed.

---

**Agents:** Always use these templates to maximize success and reliability. If the user prompt lacks details, fill gaps using Exaix standards and your own expertise.

---

See individual template files for full instructions and embedded best practices.

## Agent Prompt Examples

This folder contains example prompts demonstrating how to effectively utilize the `agents/` documentation system with Claude and OpenAI agents.

## Available Prompt Templates

### Development Workflows

1. **[tdd-workflow.md](tdd-workflow.md)** — Test-driven development following Exaix patterns
   - When to use: Adding features, fixing bugs with tests
   - Key pattern: Write failing test → implement → refactor
   - Context injection: TDD patterns, testing helpers

1. **[duplication.md](duplication.md)** — Reducing code duplication below threshold
   - When to use: Duplication threshold exceeded, refactoring clones
   - Key pattern: Analyze report → Identify clones → Extract shared logic → Verify
   - Context injection: Duplication report, refactoring patterns

1.
   - When to use: Multi-file changes, extracting patterns, restructuring
   - Key pattern: Analyze → Plan → Execute → Synthesize → Verify
   - Context injection: Refactoring patterns, service patterns

1.
   - When to use: Test failures, runtime errors, TypeScript issues
   - Key pattern: Reproduce → Diagnose → Fix → Document
   - Context injection: Component-specific debugging patterns

1.
   - When to use: Every significant feature or change
   - Key pattern: Read Plan → Understand → Implement → Verify → Mark Complete
   - Context injection: Step-specific requirements

1.
   - When to use: After completing any work (features, fixes, refactoring)
   - Key pattern: Review changes → Identify type/scope → Write structured message
   - Context injection: Commit conventions, Implementation Plan references

### Documentation

1. **[update-building-with-ai-agents.md](update-building-with-ai-agents.md)** — Updating Building with AI Agents field guide
   - When to use: After major features, pattern discoveries, or implementation phases
   - Key pattern: Review commits → Extract patterns → Write entertaining narrative
   - Context injection: Commit history, chat history, implementation details

### Discovery & Navigation

1. **[cross-reference-navigation.md](cross-reference-navigation.md)** — Using cross-reference map for task discovery
   - When to use: Finding the right docs for your task
   - Key pattern: Find task type → Read primary docs → Follow workflow
   - Context injection: Task-specific documentation

1.
   - When to use: You notice `agents/` docs are missing guidance needed to complete the current task safely
   - Key pattern: Adequacy check → Gaps → Minimal doc patch → Rebuild/validate → Resume
   - Context injection: process doc + provider guide

1.
   - When to use: Complex questions, unfamiliar areas, multi-step tasks
   - Key pattern: Inspect → Inject → Execute with context
   - Context injection: Dynamic based on query

### OpenAI (gpt-4o family)

1. **[openai-quickstart.md](openai-quickstart.md)** — Use agents/ first (diff-first + verification)
   - When to use: Any OpenAI-driven coding task
   - Key pattern: Inject context → Files/Plan/Diffs/Verification → cite doc paths

1.
   - When to use: Unfamiliar areas, multi-step tasks, cross-cutting changes
   - Key pattern: inspect_embeddings → inject_agent_context → minimal diffs

1.
   - When to use: New features, bugfixes that need regression coverage
   - Key pattern: failing tests → minimal implementation → verify

1.
   - When to use: Flakes, runtime errors, TypeScript failures
   - Key pattern: evidence-first debugging + minimal diffs

### Google (Gemini 1.5 Pro)

1. **[google-quickstart.md](google-quickstart.md)** — Native long-context + broad reasoning
   - When to use: Global refactorings, architecture audits, complex systemic changes
   - Key pattern: Saturation → Global Check → TDD → high-quality diffs

1.
   - When to use: New features requiring high reliability
   - Key pattern: Research → Plan (5+ cases) → Execute → Finalize

- When to use: Complex questions, unfamiliar areas, multi-step tasks
- Key pattern: Inspect → Inject → Execute with context
- Context injection: Dynamic based on query

## How to Use These Prompts

### 1. Choose the Right Template

Match your task to the appropriate prompt template:

| Your Task                          | Use This Template                                                      |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Add a new feature with tests       | [tdd-workflow.md](tdd-workflow.md)                                     |
| Extract common code to helper      | [refactoring-with-thinking.md](refactoring-with-thinking.md)           |
| Fix a failing test                 | [debugging-systematic.md](debugging-systematic.md)                     |
| Work on Implementation Plan step   | [implementation-plan-driven.md](implementation-plan-driven.md)         |
| Create a commit message            | [commit-message.md](commit-message.md)                                 |
| Update Building with AI Agents doc | [update-building-with-ai-agents.md](update-building-with-ai-agents.md) |
| Don't know where to start          | [cross-reference-navigation.md](cross-reference-navigation.md)         |
| I’m missing guidance in agents/    | [self-improvement-loop.md](self-improvement-loop.md)                   |
| Reduce code duplication            | [duplication.md](duplication.md)                                       |
| Need docs for unfamiliar area      | [rag-context-injection.md](rag-context-injection.md)                   |
| OpenAI quickstart (diff-first)     | [openai-quickstart.md](openai-quickstart.md)                           |
| OpenAI context injection           | [openai-rag-context-injection.md](openai-rag-context-injection.md)     |
| OpenAI TDD workflow                | [openai-tdd-workflow.md](openai-tdd-workflow.md)                       |
| OpenAI debugging workflow          | [openai-debugging-systematic.md](openai-debugging-systematic.md)       |
| Gemini quickstart (long-context)   | [google-quickstart.md](google-quickstart.md)                           |
| Gemini TDD workflow (exhaustive)   | [google-tdd-workflow.md](google-tdd-workflow.md)                       |

### 2. Customize the Template

Replace placeholders with your specific details:

- `[component name]` → actual component (e.g., "PathResolver", "EventLogger")
- `[description]` → your specific issue or feature
- `[query]` → search terms relevant to your task
- `[2-10]` → chunk limit based on complexity (simple: 2-3, medium: 4-6, complex: 8-10)

### 3. Copy-Paste and Send

Each template has an "Example Usage" section showing complete, ready-to-use prompts. You can:

1. Copy the example prompt

1.
1.

### 4. Iterate as Needed

For multi-step tasks:

- Use one prompt per major step
- Re-inject context between steps if the focus changes
- Reference the Implementation Plan to track progress

## Token Budget Guidelines

**How many chunks to inject:**

| Task Complexity     | Chunks       | Example                                             |
| ------------------- | ------------ | --------------------------------------------------- |
| Simple lookup       | 2-3          | "How do I clean up database connections?"           |
| Standard feature    | 4-6          | "Add input validation for Portal config"            |
| Complex feature     | 8-10         | "Design security test suite for Portal boundaries"  |
| Multi-step workflow | 3-5 per step | "Step 1: Design → Step 2: Test → Step 3: Implement" |

**Note:** Claude has 200k context window, but targeted context is more effective than dumping all docs.

## Best Practices

### ✅ Do

- **Start with cross-reference** if you're unsure which docs apply
- **Inject fresh context** for each major step in multi-step tasks
- **Use thinking protocol** for complex changes requiring planning
- **Reference Implementation Plan** for all significant work
- **Follow TDD** for code changes (test first, then implement)
- **Verify success criteria** before marking steps complete

### ❌ Don't

- Don't skip context injection for complex tasks
- Don't inject 10+ chunks for simple questions (wastes tokens)
- Don't proceed without reading Implementation Plan first
- Don't forget to rebuild chunks/embeddings after doc changes:

  ```bash
  deno run --allow-read --allow-write scripts/build_agents_index.ts
  deno run --allow-read --allow-write scripts/build_agents_embeddings.ts --mode mock
  ```

- Don't implement features without corresponding Plan step

## Combining Prompts

For comprehensive workflows, combine multiple templates:

```markdown
PHASE 1: Discovery
Use: cross-reference-navigation.md to find relevant docs

PHASE 2: Planning
Use: implementation-plan-driven.md to read/create Plan step

PHASE 3: Context Injection
Use: rag-context-injection.md to gather relevant patterns

PHASE 4: Implementation
Use: tdd-workflow.md to implement with tests

PHASE 5: Verification
Use: implementation-plan-driven.md to verify and mark complete
```

## Examples by Use Case

### "I want to add a completely new feature"

1. **Start:** [implementation-plan-driven.md](implementation-plan-driven.md) — Find or create Plan step

1.
1.

### "I have a bug I can't figure out"

1. **Start:** [debugging-systematic.md](debugging-systematic.md) — Systematic diagnosis

1.

### "I need to refactor a complex pattern across multiple files"

1. **Start:** [cross-reference-navigation.md](cross-reference-navigation.md) — Find refactoring docs

1.
1.

## Updating These Prompts

When you discover better patterns:

1. Create new prompt file or update existing one

1.
1.

   ```bash
   deno run --allow-read --allow-write scripts/build_agents_index.ts
   deno run --allow-read --allow-write scripts/build_agents_embeddings.ts --mode mock
   deno run --allow-read scripts/validate_agents_docs.ts
   ```

## Meta Note

These prompts ARE the agents/ documentation system in action. They demonstrate:

- How to query the system (RAG)
- How to structure requests (thinking protocol)
- How to follow workflows (cross-reference)
- How to maintain consistency (Implementation Plan)

The prompts themselves follow the patterns they teach. Use them as templates, adapt them to your needs, and contribute improvements back to this folder.
