---
agent: general
scope: dev
title: ".copilot/prompts/ — Chat Routing Wrappers"
short_summary: "Thin .prompt.md wrappers that route chat invocations to canonical .copilot/skills/ sources. One file per skill."
version: "1.0"
topics: ["prompts", "routing", "skills", "copilot", "wrappers"]
---

# .copilot/prompts/

Thin routing wrappers for all Exaix skills — one `.prompt.md` per skill.

## Purpose

These files are the chat-facing entry points for each skill. They are:

- Discovered by GitHub Copilot Chat (`.prompt.md` extension required)
- Linked to by `.github/prompts/` (symlink → this directory)
- Consumed by Qwen-style agents as slash-command triggers

Each wrapper contains only `name` and `description` frontmatter, plus a routing body that directs the agent to the canonical skill source at `.copilot/skills/<name>/SKILL.md`.

**Do not add workflow logic here.** All substantive guidance lives in `.copilot/skills/`.

## 1-to-1 skill ↔ prompt contract

Every file in this directory must have a corresponding `.copilot/skills/<name>/SKILL.md`. There are currently 21 prompts, one per skill:

| Prompt                           | Canonical skill                         |
| -------------------------------- | --------------------------------------- |
| `clean-codebase.prompt.md`       | `.copilot/skills/clean-codebase/`       |
| `commit.prompt.md`               | `.copilot/skills/commit/`               |
| `coverage.prompt.md`             | `.copilot/skills/coverage/`             |
| `doc.prompt.md`                  | `.copilot/skills/doc/`                  |
| `duplication.prompt.md`          | `.copilot/skills/duplication/`          |
| `explore.prompt.md`              | `.copilot/skills/explore/`              |
| `fix.prompt.md`                  | `.copilot/skills/fix/`                  |
| `infra.prompt.md`                | `.copilot/skills/infra/`                |
| `lint.prompt.md`                 | `.copilot/skills/lint/`                 |
| `next-steps.prompt.md`           | `.copilot/skills/next-steps/`           |
| `plan.prompt.md`                 | `.copilot/skills/plan/`                 |
| `post-gap-analysis.prompt.md`    | `.copilot/skills/post-gap-analysis/`    |
| `pre-gap-analysis.prompt.md`     | `.copilot/skills/pre-gap-analysis/`     |
| `refactor.prompt.md`             | `.copilot/skills/refactor/`             |
| `refactor-check-magic.prompt.md` | `.copilot/skills/refactor-check-magic/` |
| `review.prompt.md`               | `.copilot/skills/review/`               |
| `review-research.prompt.md`      | `.copilot/skills/review-research/`      |
| `security.prompt.md`             | `.copilot/skills/security/`             |
| `submodule-workflow.prompt.md`   | `.copilot/skills/submodule-workflow/`   |
| `tdd-workflow.prompt.md`         | `.copilot/skills/tdd-workflow/`         |
| `upgrade.prompt.md`              | `.copilot/skills/upgrade/`              |

## Adding a new skill

1. Create `.copilot/skills/<name>/SKILL.md` with full workflow content
2. Create `.qwen/skills/<name>/SKILL.md` routing wrapper (copy an existing one)
3. Add `.qwen/skills/<name>` to `.qwen/settings.json`
4. Run: `deno run --allow-read --allow-write scripts/generate_prompt.ts --skill <name>`
5. Run: `deno run --allow-read --allow-write scripts/build_agents_index.ts`
6. Update the table above
