---
agent: agent
description: "Refactor magic-value violations from deno task check:magic"
tools:
  - git_status
  - search_files
  - patch_file
  - run_command
---

# Refactor check:magic violations

Thin slash-command wrapper for the canonical magic-value refactoring workflow.

Canonical source of truth:

- `../../.copilot/prompts/refactor-check-magic-comprehensive.md`

Use this command to:

1. Run a focused `deno task check:magic` cleanup.
1. Follow the workflow and guardrails defined in the canonical `.copilot` prompt.
1. Report deltas and changed files without introducing a second refactoring policy here.

Execution requirements:

1. Treat `../../.copilot/prompts/refactor-check-magic-comprehensive.md` as authoritative.
1. Prefer existing shared constants and enums over local ad-hoc literals.
1. Avoid checker-whitelist tricks or broad suppression changes unless explicitly justified.
1. Keep edits minimal and behavior-preserving.

Output format:

1. Top offenders before the batch.
1. Files changed and why.
1. Updated `check:magic` delta after the batch.
1. Remaining best next candidates.
