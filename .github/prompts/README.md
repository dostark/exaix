---
agent: agent
description: "Explains the purpose of .github/prompts and how it differs from .copilot/prompts"
tools:
  - search/codebase
---

# GitHub slash-command prompts

This directory is for GitHub/Copilot slash-command prompt definitions.

These files are not the same thing as the agent prompt templates in `../../.copilot/prompts/`.

## What belongs here

- Slash-command definitions intended for GitHub Copilot or editor integrations.
- Files that use the `.github/prompts` frontmatter pattern such as:
  - `agent`
  - `description`
  - `tools`

## What does not belong here

- General agent workflow templates.
- RAG/indexed guidance meant for `scripts/build_agents_index.ts`.
- Files that should be discoverable via `.copilot/manifest.json` or `scripts/inject_agent_context.ts`.

## Directory split

- `../../.copilot/prompts/`: canonical Exaix prompt library for agent workflows, indexed and validated by Exaix tooling.
- `.github/prompts/`: slash commands for GitHub/Copilot editor experiences.

If a prompt needs to be both:

1. Keep the canonical, detailed guidance in `../../.copilot/prompts/`.
1. Add a thin slash-command wrapper in `.github/prompts/` that points at the canonical `.copilot` file.

That keeps one source of truth for the actual workflow while preserving the integration-specific format required by GitHub/Copilot.

## Available slash commands

- `/commit` -> `commit.prompt.md` (canonical: `../../.copilot/prompts/commit-message.md`)
- `/refactor-check-magic` -> `refactor-check-magic.prompt.md` (canonical: `../../.copilot/prompts/refactor-check-magic-comprehensive.md`)
- `/next-steps` -> `next-steps.prompt.md` (canonical: `../../.copilot/prompts/tdd-phase-steps.md`)
- `/pre-gap-analysis` -> `pre-gap-analysis.prompt.md` (canonical: `../../.copilot/prompts/pre-gap-analysis.md`)
- `/post-gap-analysis` -> `post-gap-analysis.prompt.md` (canonical: `../../.copilot/prompts/post-gap-analysis.md`)
- `/plan` -> `plan.prompt.md` (canonical: `../../.copilot/prompts/plan.md`)
- `/submodule-workflow` -> `submodule-workflow.prompt.md` (canonical: `../../.copilot/prompts/submodule-workflow.md`)
- `/clean-codebase` -> `clean-codebase.prompt.md` (canonical: `../../.copilot/prompts/clean-codebase.md`)
