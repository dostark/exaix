---
agent: general
scope: dev
title: ".copilot/prompts/ — Chat Routing Wrappers"
short_summary: "Thin .prompt.md wrappers that route chat invocations to canonical .copilot/skills/ sources. One file per skill."
version: "1.0"
topics: ["prompts", "routing", "skills", "copilot", "wrappers"]
---

Thin routing wrappers for all Exaix skills — one `.prompt.md` per skill.

## Purpose

These files are the chat-facing entry points for each skill. They are:

- Discovered by GitHub Copilot Chat (`.prompt.md` extension required)
- Linked to by `.github/prompts/` (symlink → this directory)
- Consumed by Qwen-style agents as slash-command triggers

Each wrapper contains only `name` and `description` frontmatter, plus a routing body that directs the agent to the canonical skill source at `.copilot/skills/<name>/SKILL.md`.

**Do not add workflow logic here.** All substantive guidance lives in `.copilot/skills/`.

## 1-to-1 skill ↔ prompt contract

Every file in this directory must have a corresponding `.copilot/skills/<name>/SKILL.md`. There are currently 29 prompts, one per skill:

| Prompt                           | Canonical skill                         |
| -------------------------------- | --------------------------------------- |
| `clean-codebase.prompt.md`       | `.copilot/skills/clean-codebase/`       |
| `commit.prompt.md`               | `.copilot/skills/commit/`               |
| `comparative-analysis.prompt.md` | `.copilot/skills/comparative-analysis/` |
| `coverage.prompt.md`             | `.copilot/skills/coverage/`             |
| `doc.prompt.md`                  | `.copilot/skills/doc/`                  |
| `dogfood-development.prompt.md`  | `.copilot/skills/dogfood-development/`  |
| `edition-development.prompt.md`  | `.copilot/skills/edition-development/`  |
| `exaix-development.prompt.md`    | `.copilot/skills/exaix-development/`    |
| `explore.prompt.md`              | `.copilot/skills/explore/`              |
| `fix-bug.prompt.md`              | `.copilot/skills/fix-bug/`              |
| `infra.prompt.md`                | `.copilot/skills/infra/`                |
| `next-phase.prompt.md`           | `.copilot/skills/next-phase/`           |
| `next-steps.prompt.md`           | `.copilot/skills/next-steps/`           |
| `package-extraction.prompt.md`   | `.copilot/skills/package-extraction/`   |
| `plan.prompt.md`                 | `.copilot/skills/plan/`                 |
| `post-gap-analysis.prompt.md`    | `.copilot/skills/post-gap-analysis/`    |
| `pre-gap-analysis.prompt.md`     | `.copilot/skills/pre-gap-analysis/`     |
| `refactor.prompt.md`             | `.copilot/skills/refactor/`             |
| `refactor-check-magic.prompt.md` | `.copilot/skills/refactor-check-magic/` |
| `remediate-code-gaps.prompt.md`  | `.copilot/skills/remediate-code-gaps/`  |
| `remediate-plan-gaps.prompt.md`  | `.copilot/skills/remediate-plan-gaps/`  |
| `review-code.prompt.md`          | `.copilot/skills/review-code/`          |
| `review-research.prompt.md`      | `.copilot/skills/review-research/`      |
| `security.prompt.md`             | `.copilot/skills/security/`             |
| `self-improvement.prompt.md`     | `.copilot/skills/self-improvement/`     |
| `submodule-workflow.prompt.md`   | `.copilot/skills/submodule-workflow/`   |
| `tdd-workflow.prompt.md`         | `.copilot/skills/tdd-workflow/`         |
| `test-development.prompt.md`     | `.copilot/skills/test-development/`     |
| `upgrade.prompt.md`              | `.copilot/skills/upgrade/`              |

## Adding a new skill

1. Create `.copilot/skills/<name>/SKILL.md` with full workflow content
2. Add a `qwen_skill: <name>` frontmatter key to that SKILL.md, then add
   `".copilot/skills/<name>"` to the `skills` array in `.qwen/settings.json` — there is no
   separate `.qwen/skills/` wrapper directory; Qwen consumes `.copilot/skills/` directly.
   Verify with `deno run -A scripts/check_qwen_skills_sync.ts`.
3. Run: `deno run --allow-read --allow-write scripts/generate_prompt.ts --skill <name>`
4. Run: `deno run --allow-read --allow-write scripts/build_agents_index.ts`
5. Update the table above
