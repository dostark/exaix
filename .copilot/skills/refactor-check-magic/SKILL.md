---
name: refactor-check-magic
agent: general
tools:
  - run_command
  - read_file
  - patch_file
  - write_file
  - search_files
scope: dev
title: "Refactor-Check-Magic Skill (#refactor-check-magic)"
description: Refactor magic-value violations from deno task check:magic
short_summary: "Execution prompt for reducing magic value violations using principled refactoring, shared constants/enums, and behavior-preserving changes."
version: "1.0"
topics: ["refactoring", "magic-values", "constants", "enums", "code-quality", "tdd"]
qwen_skill: refactor-check-magic
---

## Purpose

Use this skill to drive a full, disciplined refactor pass for violations reported by:

```bash
deno task check:magic
```

The goal is to reduce true magic-value violations while preserving behavior and avoiding suppression tricks.

## Canonical Prompt

You are a senior TypeScript refactoring agent working in the Exaix repository.

Your mission is to reduce violations from `deno task check:magic` through real code improvements.

Hard constraints:

1. Do not cheat by broad literal whitelisting.
1. Do not hide findings by weakening core detection logic unless it is a narrowly justified structural false-positive rule.
1. Prefer extracting shared constants/enums over local ad-hoc constants when literals are reused across files.
1. Preserve runtime behavior and public interfaces unless explicitly required otherwise.
1. Keep changes minimal, targeted, and readable.
1. Keep tests and CI quality gates passing.

Process:

1. Run `deno task check:magic` and capture the ranked offenders.
1. Triage the top 10 by category:
   - Refactorable domain literals (best target)
   - Structural/tooling literals (may require narrow heuristic suppression)
   - Legitimate protocol/CLI/schema literals (document and defer if needed)
1. Per batch: pick 1–3 high-impact literals with a clear refactor path. Implement
   targeted changes, re-run `deno task check:magic`, and report delta.
1. Refactor by:
   - Reusing existing constants/enums from `src/shared/constants.ts` and `src/shared/enums.ts`
   - Introducing new shared constants/enums only when justified by multi-file reuse
   - Replacing hardcoded fallbacks (e.g., status/actor/scope labels) with canonical symbols
1. Stop when further changes are mostly noise or would require policy-level checker changes.

Output requirements:

- Show a concise before/after for top offenders and total violations.
- List all files changed and why each change was safe.
- Call out any literals intentionally left unchanged with rationale.

## Refactoring Heuristics (Do)

1. Consolidate repeated CLI option/help strings into shared constants when repeated many times in one module.
1. Replace repeated actor/scope/state literals with existing enums (for example, activity actor or memory scope values).
1. Replace repeated node-type literals in TUI trees with canonical enum values.
1. Extract shared fallback labels (for example, unknown/default labels) into shared constants if reused across multiple modules.
1. Prefer existing canonical definitions over introducing duplicates.
1. Keep naming explicit and domain-driven.

## Anti-Patterns (Do Not)

1. Adding many value-based whitelist entries solely to make the checker quiet.
1. Blanket ignore rules that hide real findings.
1. Over-generalizing constants that make code less clear.
1. Refactors that alter behavior, CLI semantics, or schema contracts without tests.

## Required Validation

```bash
deno task check:magic
deno lint
deno task check:arch
deno test --allow-all
```

If scope is large, run focused tests first, then full suite.
If any test fails after a refactor batch, revert the batch and narrow scope before retrying.

## Deliverable Format

- Summary: what improved and by how much.
- Findings addressed: literal → strategy → files.
- Residual high-score literals: reason not addressed yet.
- Next best 3 candidates for follow-up.

## Notes for Exaix Conventions

- Prefer symbols from `src/shared/constants.ts` and `src/shared/enums.ts`.
- Keep imports top-level and type-safe.
- Avoid introducing magic numbers/strings in new code.
- Maintain strict TypeScript compatibility and existing architecture patterns.
- After renaming symbols or moving constants, re-run `deno task check:arch` — renaming
  can break module JSDoc grounding and produce UNGROUNDED files.
- When the scope involves more than ~20 files, work in batches of 5–10: read a batch, record findings, then continue.

## Related Skills

- `#commit` — Create a structured commit after a successful refactor batch.
- `#plan` — If this analysis reveals a systemic issue requiring architectural
  changes, start a new phase document with `#plan`.
- `#next-steps` — If this refactor is part of an active phase, continue via `#next-steps`.
- [CODE_STYLE.md](../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules

## Output Format

1. **Violation delta** — total count before vs. after each batch.
1. **Findings addressed** — literal → strategy → files changed.
1. **Residual high-score literals** — reason not addressed (e.g., protocol constraint,
   legitimate schema literal, requires policy-level checker change).
1. **Next 3 candidates** — best remaining targets for a follow-up session.
1. **CI gate results** — `check:magic`, `lint`, `check:arch`, `deno check` status.
1. **Commit payload** — use `#commit` to generate the final structured message.

## Examples

- `#refactor-check-magic` — address all current check:magic violations
- `#refactor-check-magic src/services/plan_service.ts` — fix magic values in one file
- `#refactor-check-magic — top 10 highest-score literals only`
