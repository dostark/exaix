---
agent: general
scope: dev
title: .copilot/ — AI Agent Knowledge Base
short_summary: "Overview of the .copilot/ directory: prompts, skills, and docs for multi-agent Exaix development."
version: "2.0"
---

## Purpose

This directory is the **AI agent knowledge base** for the Exaix project. It is consumed by all AI agents (Claude Code, Qwen, GitHub Copilot, etc.) via a symlink chain:

```text
.claude/  →  .copilot/  ←  .agents/  ←  .cursor/
```

Content is organized by **role**, not by provider.

## Directory Structure

```text
.copilot/
├── prompts/        # Chat routing wrappers — one .prompt.md per skill (symlinked from .github/prompts/)
├── skills/         # Multi-step autonomous workflows (one SKILL.md per skill)
├── docs/           # On-demand reference documents (agent-oriented; reachable as .agents/references/)
├── references/     # Symlink → docs/ (backward-compatible alias)
├── planning/       # Reserved — active phase docs live in exaix-dev-docs/planning/
├── DOCS.md         # Auto-generated doc catalog (tasks + topics)
└── manifest.json   # Auto-generated index of all agent docs
```

## Role Distinction

| Directory  | Role             | Format                                 | When to use                                        |
| ---------- | ---------------- | -------------------------------------- | -------------------------------------------------- |
| `prompts/` | Routing wrapper  | `.prompt.md`, `name:` + `description:` | Thin wrappers that route to canonical skill source |
| `skills/`  | Autonomous skill | `SKILL.md` per skill                   | Multi-step workflows that run autonomously         |
| `docs/`    | Reference doc    | Markdown                               | Consult for patterns, standards, processes         |

## Quick Navigation

- **Find the right doc for a task**: [manifest.json](manifest.json)
- **Skills**: [skills/](skills/) — commit, plan, review, fix-bug, clean-codebase, coverage, security, package-extraction, and more
- **Prompts**: [prompts/](prompts/) — thin routing wrappers, one per skill (also at `.github/prompts/`)
- **Reference docs**: [docs/](docs/) — exaix-development, testing, documentation, agent-content-schema, and more

## Qwen Integration

`.qwen/settings.json` references `.copilot/skills/` directly — no routing wrappers needed. Skills are registered manually in that file.

## GitHub Copilot Integration

`.github/prompts/` is a symlink to `.copilot/prompts/`. All `.prompt.md` files in `.copilot/prompts/` are automatically visible to GitHub Copilot Chat.

Each prompt is a thin routing wrapper pointing to the canonical `.copilot/skills/<name>/SKILL.md`. There is a 1-to-1 correspondence between prompts and skills.

## Maintenance

After adding or updating files in `.copilot/`:

```bash
# Regenerate manifest and chunks
deno run --allow-read --allow-write scripts/build_agents_index.ts

# Validate frontmatter and content
deno run --allow-read scripts/validate_agents_docs.ts
```

## How to Add a New Agent Doc

### 1. Create File in Appropriate Subfolder

- Use `docs/` for on-demand reference docs, `skills/` for autonomous workflows, and `prompts/` for routing wrappers.
- To add a new skill, also run `scripts/generate_prompt.ts --skill <name>` to create the corresponding `.copilot/prompts/<name>.prompt.md` wrapper, add the matching `.qwen/skills/<name>/` routing wrapper, and register it in `.qwen/settings.json`.

### 2. Add YAML Frontmatter

```yaml
---
agent: general
scope: dev
title: "Your Title"
description: One-line description for slash command menus  # required for prompts/
short_summary: "Brief summary for RAG injection (≤200 chars)"
version: "0.1"
topics: ["keyword1", "keyword2"]
---
```

### 3. Include Required Sections

- Skill and prompt files should include `Key points`, `Canonical prompt`, `Examples`, and `Do / Don't`. Guidelines files use their own domain-appropriate headings.
- Prompt templates should still carry frontmatter and a concrete reusable template body.

### 4. Regenerate Manifest

```bash
deno run --allow-read --allow-write scripts/build_agents_index.ts
```

> **Note:** Gate 6 (pre-commit hook) auto-runs this script and stages the result whenever `.copilot/` sources are staged — the manual command above is only needed to preview changes before committing.

### 5. Validate

```bash
deno task docs-agent-validate
```

### 6. Test Retrieval

```bash
deno run --allow-read scripts/inject_agent_context.ts openai "your topic" 4
```

## Common Mistakes to Avoid

- Forgetting required frontmatter keys.
- Skipping manifest/chunk regeneration after adding docs.
- Adding provider-specific prompt text without a reusable prompt template in `prompts/`.
- Breaking references to legacy compatibility paths like `workflows/`, `process/`, or `prompts/` while tests still enforce them.
- Editing Secondary Docs in `cross-reference.md` by hand: the `updateCrossReference()` function in `build_agents_index.ts` regenerates the task table and topic list from scratch on every build, silently wiping all manually added secondary doc links. Re-add curated links after each rebuild, or store relationships in skill frontmatter so the builder can pick them up automatically.

## Frontmatter Schema

### Files inside `.copilot/`

Every file inside `.copilot/` MUST include:

```yaml
---
agent: general       # or: claude, openai, google
scope: dev           # or: ci, docs, test
title: "Your Title"
description: One-line description for slash command menus  # required for prompts/
short_summary: "Brief summary for RAG injection (≤200 chars)"
version: "0.1"
topics: ["keyword1", "keyword2"]
---
```

The `description:` field is mandatory for files in `prompts/` — it powers slash command menu display.

### Root-level `.md` files

Root-level files (README.md, TOOLS.md, CLAUDE.md, CONTRIBUTING.md, etc.) use a different set of fields. To include a root-level file in the agent knowledge base, add `copilot_knowledge_base: true` — the build script uses this as the inclusion filter:

```yaml
---
title: "Your Title"
description: "One-line description"
agent_priority: high   # critical | high | medium | low
copilot_knowledge_base: true
capabilities: [cap1, cap2]
short_summary: "Brief summary for RAG injection (≤200 chars)"
version: 1.0
topics: ["keyword1", "keyword2"]
---
```

Do **not** use `agent:`, `scope:`, or `identity:` in root-level files — those are `.copilot/`-internal fields.
