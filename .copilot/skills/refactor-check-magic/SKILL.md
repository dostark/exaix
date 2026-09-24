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
version: "1.0.0"
topics: ["refactoring", "magic-values", "constants", "enums", "code-quality", "tdd"]
qwen_skill: refactor-check-magic
---

## Purpose

Drive a disciplined refactor pass for violations reported by `deno task check:magic`.
Reduce true magic-value violations while preserving behavior — no suppression tricks.

## Canonical Prompt

Reduce `deno task check:magic` violations through real code improvements.

Hard constraints:

1. No broad literal whitelisting to cheat.
1. No weakening core detection logic, unless a narrowly justified structural
   false-positive rule.
1. Prefer shared constants/enums over local ad-hoc constants when literals repeat across
   files.
1. Preserve runtime behavior and public interfaces unless explicitly required otherwise.
1. Keep changes minimal, targeted, readable.
1. Keep tests and CI quality gates passing.

Process:

1. Run `deno task check:magic`; capture the ranked offenders.
1. Triage the top 10 by category:
   - Refactorable domain literals (best target)
   - Structural/tooling literals (may need narrow heuristic suppression)
   - Legitimate protocol/CLI/schema literals (document and defer if needed)
1. Per batch: pick 1–3 high-impact literals with a clear path. Implement targeted
   changes, re-run `deno task check:magic`, report the delta.
1. Refactor by:
   - Reusing existing constants/enums from `packages/core/src/types/constants.ts` and
     package-owned enums
   - Introducing new shared constants/enums only when multi-file reuse justifies it
   - Replacing hardcoded fallbacks (status/actor/scope labels) with canonical symbols
1. Stop when further changes are mostly noise or need policy-level checker changes.

Output requirements:

- Concise before/after for top offenders and total violations.
- All files changed and why each change was safe.
- Literals intentionally left unchanged, with rationale.

## Refactoring Heuristics (Do)

1. Consolidate repeated CLI option/help strings into shared constants when repeated
   many times in one module.
1. Replace repeated actor/scope/state literals with existing enums (activity actor,
   memory scope).
1. Replace repeated node-type literals in TUI trees with canonical enum values.
1. Extract shared fallback labels (unknown/default) into shared constants when reused
   across modules.
1. Prefer existing canonical definitions over duplicates.
1. Keep naming explicit and domain-driven.

## Anti-Patterns (Do Not)

1. Many value-based whitelist entries just to quiet the checker.
1. Blanket ignore rules hiding real findings.
1. Over-generalized constants that make code less clear.
1. Refactors altering behavior, CLI semantics, or schema contracts without tests.

## Required Validation

```bash
deno task check:magic
deno lint
deno task check:arch
deno test --allow-all
```

Large scope: focused tests first, then the full suite. A failing test after a batch?
Revert the batch and narrow scope.

## Deliverable Format

- Summary: what improved and by how much.
- Findings addressed: literal → strategy → files.
- Residual high-score literals: reason not addressed.
- Next 3 best candidates for follow-up.

## Duplication Detection

Beyond magic values, run `scripts/measure_duplication.ts` (`deno task check:duplication`,
Gate 9):

```bash
deno run --allow-run --allow-read --allow-write scripts/measure_duplication.ts --threshold 2.0
```

### Duplication Thresholds

| Level | Percentage | Action |
| ----- | ---------- | ------ |
| 🟢 Good | < 2% | No action needed |
| 🟡 Warning | 2-5% | Monitor, refactor when convenient |
| 🟠 High | 5-10% | Plan a refactoring phase |
| 🔴 Critical | > 10% | Immediate attention |

### Common Duplication Patterns

1. **Test setup duplication** — repeated fixtures → extract to test helpers.
1. **Provider pattern duplication** — same constructor patterns → base class.
1. **Test assertion patterns** — repeated assertion blocks → custom helpers.

### When NOT to Deduplicate

1. **Intentional isolation** — security tests stay standalone.
1. **Test clarity** — some repetition improves readability.
1. **Evolution** — tests that may diverge stay separate.
1. **Small clones** — < 50 tokens rarely worth extracting.

## Notes for Exaix Conventions

- Prefer symbols from `packages/core/src/types/constants.ts` and package-owned enums.
- Keep imports top-level and type-safe. No new magic numbers/strings.
- After renaming symbols or moving constants, re-run `deno task check:arch` — renaming
  can break module JSDoc grounding and produce UNGROUNDED files.
- Scope > ~20 files: batches of 5–10. Read a batch, record findings, continue.

## Related Skills

- `#commit` — structured commit after a successful refactor batch.
- `#plan` — systemic issue needing architectural work → start a phase doc.
- `#next-steps` — refactor part of an active phase → continue via #next-steps.
- [CODE_STYLE.md](../../../CODE_STYLE.md) — naming, type, import, constants rules.

## Output Format

1. **Violation delta** — total before vs. after each batch.
1. **Findings addressed** — literal → strategy → files changed.
1. **Residual high-score literals** — reason not addressed.
1. **Next 3 candidates** — best follow-up targets.
1. **CI gate results** — check:magic, lint, check:arch, deno check.
1. **Commit payload** — use `#commit`.

## Examples

- `#refactor-check-magic` — all current check:magic violations
- `#refactor-check-magic` scoped to one file
- `#refactor-check-magic — top 10 highest-score literals only`

---
exaix:
  skill_id: refactor-check-magic
  related_skills: [exaix-development, test-development]
  triggers:
    keywords: [refactor-check-magic, magic-numbers, magic-values, constants, literal]
    task_types: [refactor]
    tags: [magic-numbers, refactoring]
  constraints:
    - "Do not alter behaviour — tests must pass identically before and after"
    - "Prefer existing canonical definitions over introducing duplicates"
    - "Keep naming explicit and domain-driven"
    - "Do not add blanket ignore rules that hide real findings"
    - "Do not over-generalize constants that make code less clear"
  output_requirements:
    - "Violation delta: total count before vs. after each batch"
    - "Findings addressed: literal, strategy, files changed"
    - "Residual high-score literals with reason not addressed"
    - "Next 3 best candidates for follow-up"
    - "CI gate results: check:magic, lint, check:arch, deno check"
  quality_criteria:
    - name: violation_reduction
      description: Magic value violation count reduced
      weight: 40
    - name: naming_quality
      description: Extracted constants have explicit, domain-driven names
      weight: 30
    - name: behavioral_neutrality
      description: No behavioral changes introduced
      weight: 30
---
