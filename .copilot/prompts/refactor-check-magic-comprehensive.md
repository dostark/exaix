---
agent: general
scope: dev
title: "Comprehensive Refactor Prompt for check:magic Violations"
short_summary: "Execution prompt for reducing magic value violations using principled refactoring, shared constants/enums, and behavior-preserving changes."
version: "0.1"
topics: ["refactoring", "magic-values", "constants", "enums", "code-quality", "tdd"]
---

## Purpose

Use this prompt to drive a full, disciplined refactor pass for violations reported by:

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
1. Refactor highest-impact literals by:
   - Reusing existing constants/enums from `src/shared/constants.ts` and `src/shared/enums.ts`
   - Introducing new shared constants/enums only when justified by multi-file reuse
   - Replacing hardcoded fallbacks (e.g., status/actor/scope labels) with canonical symbols
1. Re-run `deno task check:magic` after each batch and report delta.
1. Continue until top offenders are meaningfully reduced.

Output requirements:

- Show a concise before/after for top offenders and total violations.
- List all files changed and why each change was safe.
- Call out any literals intentionally left unchanged with rationale.

## Current Baseline (example seed)

Use the current report as a starting triage set (update with fresh run before coding):

- `"test"`
- `"yellow"`
- `"list"`
- `"portal"`
- `"deno"`
- `"Execution"`
- `"write_file"`
- `"branch"`
- `"green"`

Treat these as initial candidates, not fixed truth.

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

Run and report:

```bash
deno task check:magic
```

Recommended additional validation for touched code:

```bash
deno lint
deno test --allow-all
```

If scope is large, run focused tests first, then full suite.

## Suggested Execution Loop

1. Capture top offenders.
1. Pick 1-3 high-impact literals with clear refactor path.
1. Implement targeted changes.
1. Validate diagnostics and run `check:magic`.
1. Repeat.

Stop when further changes are mostly noise or would require policy-level checker changes.

## Deliverable Format

- Summary: what improved and by how much.
- Findings addressed: literal -> strategy -> files.
- Residual high-score literals: reason not addressed yet.
- Next best 3 candidates for follow-up.

## Notes for Exaix Conventions

- Prefer symbols from `src/shared/constants.ts` and `src/shared/enums.ts`.
- Keep imports top-level and type-safe.
- Avoid introducing magic numbers/strings in new code.
- Maintain strict TypeScript compatibility and existing architecture patterns.
