---
agent: general
scope: dev
title: .copilot/ — AI Agent Knowledge Base
short_summary: "Overview of the .copilot/ directory: commands, skills, guidelines, and providers for multi-agent Exaix development."
version: "2.0"
---

## Purpose

This directory is the **AI agent knowledge base** for the Exaix project. It is consumed by all AI agents (Claude Code, Qwen, GitHub Copilot, etc.) via a symlink chain:

```
.claude/  →  .copilot/  ←  .agents/  ←  .cursor/
```

Content is organized by **role**, not by provider.

## Directory Structure

```
.copilot/
├── commands/       # Slash commands — injected as user message on invocation
├── skills/         # Multi-step autonomous workflows (one SKILL.md per skill)
├── guidelines/     # Reference guidelines and process documents
├── providers/      # Provider-specific adaptation notes
├── planning/       # Phase planning documents (.copilot/planning/phase-NN-*.md)
├── cross-reference.md  # Task → document quick reference (start here)
├── manifest.json   # Auto-generated index of all agent docs
└── chunks/         # Auto-generated pre-chunked text for RAG retrieval
```

## Role Distinction

| Directory    | Role | Format | When to use |
|---|---|---|---|
| `commands/`  | Slash command | `description:` field required | Short invocation prompts — invoked as `/command-name` |
| `skills/`    | Autonomous skill | `SKILL.md` per skill | Multi-step workflows that run autonomously |
| `guidelines/`| Reference doc | Markdown | Consult for patterns, standards, processes |
| `providers/` | Adaptation notes | Markdown | Provider-specific tips for Claude/OpenAI/Gemini |

## Quick Navigation

- **Find the right doc for a task**: [cross-reference.md](cross-reference.md)
- **Skills**: [skills/](skills/) — commit, plan, next-steps, pre-gap-analysis, post-gap-analysis, refactor-check-magic
- **Commands**: [commands/](commands/) — fix, review, test, refactor, doc, security, lint, etc.
- **Guidelines**: [guidelines/](guidelines/) — exaix-development, testing, documentation, security-review, self-improvement, etc.
- **Providers**: [providers/claude.md](providers/claude.md), [providers/openai.md](providers/openai.md), [providers/google.md](providers/google.md)

## Qwen Integration

`.qwen/skills/` contains thin routing wrappers that point to `.copilot/skills/<name>/SKILL.md`.

| Qwen Skill                           | Canonical Source                                          |
| ------------------------------------ | --------------------------------------------------------- |
| `.qwen/skills/commit/`               | `.copilot/skills/commit/SKILL.md`                         |
| `.qwen/skills/plan/`                 | `.copilot/skills/plan/SKILL.md`                           |
| `.qwen/skills/next-steps/`           | `.copilot/skills/next-steps/SKILL.md`                     |
| `.qwen/skills/pre-gap-analysis/`     | `.copilot/skills/pre-gap-analysis/SKILL.md`               |
| `.qwen/skills/post-gap-analysis/`    | `.copilot/skills/post-gap-analysis/SKILL.md`              |
| `.qwen/skills/refactor-check-magic/` | `.copilot/skills/refactor-check-magic/SKILL.md`           |

## GitHub Copilot Integration

`.github/prompts/` contains GitHub Copilot slash-command definitions (different schema from `.copilot/`).
Do not move files between `.copilot/commands/` and `.github/prompts/` — they use different frontmatter schemas.

## Maintenance

After adding or updating files in `.copilot/`:

```bash
# Regenerate manifest and chunks
deno run --allow-read --allow-write scripts/build_agents_index.ts

# Validate frontmatter and content
deno run --allow-read scripts/validate_agents_docs.ts
```

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

The `description:` field is mandatory for files in `commands/` — it powers slash command menu display.
