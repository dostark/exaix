---
description: Refactor magic-value violations from deno task check:magic
---

# Refactor check:magic violations

Thin slash-command wrapper for the canonical magic-value refactoring workflow.

## Canonical source of truth:
- `.copilot/prompts/refactor-check-magic-comprehensive.md`

## Use this command to:
1. Run a focused `deno task check:magic` cleanup.
2. Follow the workflow and guardrails defined in the canonical `.copilot` prompt.
3. Report deltas and changed files without introducing a second refactoring policy here.

## Execution requirements:
1. Treat `.copilot/prompts/refactor-check-magic-comprehensive.md` as authoritative.
2. Prefer existing shared constants and enums over local ad-hoc literals.
3. Avoid checker-whitelist tricks or broad suppression changes unless explicitly justified.
4. Keep edits minimal and behavior-preserving.

## Output format:
1. Top offenders before the batch.
2. Files changed and why.
3. Updated `check:magic` delta after the batch.
4. Remaining best next candidates.
