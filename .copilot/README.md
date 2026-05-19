---
agent: general
scope: dev
title: .copilot/ — AI Agent Knowledge Base
short_summary: "Overview of the .copilot/ directory: prompts, skills, guidelines, and providers for multi-agent Exaix development."
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
├── guidelines/     # Reference guidelines and process documents
├── providers/      # Provider-specific adaptation notes
├── planning/       # Phase planning documents (.copilot/planning/phase-NN-*.md)
├── cross-reference.md  # Task → document quick reference (start here)
├── manifest.json   # Auto-generated index of all agent docs
└── chunks/         # Auto-generated pre-chunked text for RAG retrieval
```

## Role Distinction

| Directory     | Role             | Format                                 | When to use                                        |
| ------------- | ---------------- | -------------------------------------- | -------------------------------------------------- |
| `prompts/`    | Routing wrapper  | `.prompt.md`, `name:` + `description:` | Thin wrappers that route to canonical skill source |
| `skills/`     | Autonomous skill | `SKILL.md` per skill                   | Multi-step workflows that run autonomously         |
| `guidelines/` | Reference doc    | Markdown                               | Consult for patterns, standards, processes         |
| `providers/`  | Adaptation notes | Markdown                               | Provider-specific tips for Claude/OpenAI/Gemini    |

## Quick Navigation

- **Find the right doc for a task**: [cross-reference.md](cross-reference.md)
- **Skills**: [skills/](skills/) — 20 skills covering commit, plan, package extraction, fix-bug, review, security, coverage, and more
- **Prompts**: [prompts/](prompts/) — thin routing wrappers, one per skill (also at `.github/prompts/`)
- **Guidelines**: [guidelines/](guidelines/) — exaix-development, testing, documentation, security-review, self-improvement, etc.
- **Providers**: [providers/claude.md](providers/claude.md), [providers/openai.md](providers/openai.md), [providers/google.md](providers/google.md)

## Qwen Integration

`.qwen/skills/` contains thin routing wrappers that point to `.copilot/skills/<name>/SKILL.md`.

| Qwen Skill                           | Canonical Source                                |
| ------------------------------------ | ----------------------------------------------- |
| `.qwen/skills/commit/`               | `.copilot/skills/commit/SKILL.md`               |
| `.qwen/skills/package-extraction/`   | `.copilot/skills/package-extraction/SKILL.md`   |
| `.qwen/skills/plan/`                 | `.copilot/skills/plan/SKILL.md`                 |
| `.qwen/skills/next-steps/`           | `.copilot/skills/next-steps/SKILL.md`           |
| `.qwen/skills/pre-gap-analysis/`     | `.copilot/skills/pre-gap-analysis/SKILL.md`     |
| `.qwen/skills/post-gap-analysis/`    | `.copilot/skills/post-gap-analysis/SKILL.md`    |
| `.qwen/skills/refactor-check-magic/` | `.copilot/skills/refactor-check-magic/SKILL.md` |

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

- Use `providers/` for model-specific notes, `guidelines/` for reference docs, and `skills/` for autonomous workflows.
- To add a new skill, also run `scripts/generate_prompt.ts --skill <name>` to create the corresponding `.copilot/prompts/<name>.prompt.md` wrapper, add the matching `.qwen/skills/<name>/` routing wrapper, and register it in `.qwen/settings.json`.

### 2. Add YAML Frontmatter

```yaml
---
agent: general
identity: general
scope: dev
title: "Your Title"
short_summary: "Brief summary for RAG injection (<=200 chars)"
version: "0.1"
---
```

### 3. Include Required Sections

- Most non-template docs should include `Key points`, `Canonical prompt`, `Examples`, and `Do / Don't`.
- Prompt templates should still carry frontmatter and a concrete reusable template body.

### 4. Regenerate Manifest

```bash
deno run --allow-read --allow-write scripts/build_agents_index.ts
```

### 5. Validate

```bash
deno run --allow-read scripts/validate_agents_docs.ts
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

## Frontmatter Schema

Every agent doc MUST include:

```yaml
---
agent: general       # or: claude, openai, google, senior-coder
scope: dev           # or: ci, docs, test
title: "Your Title"
description: One-line description for slash command menus  # required for commands/
short_summary: "Brief summary for RAG injection (≤200 chars)"
version: "0.1"
topics: ["keyword1", "keyword2"]
---
```

The `description:` field is mandatory for files in `prompts/` — it powers slash command menu display.
