---
name: next-steps
description: Run plan-driven TDD step-by-step workflow with CI gates and per-step commits
---

# Next implementation step (TDD)

Thin slash-command wrapper for the canonical plan-driven TDD workflow.

## Canonical source of truth

- `.copilot/prompts/tdd-phase-steps.md`

## Use this command to

1. Continue with the next unchecked step in the active `.copilot/planning/phase-*.md` document.
1. Follow strict RED -> GREEN -> REFACTOR for that single step.
1. Run required fast CI gates before considering the step complete.
1. Update success criteria and planned-test markers in the planning doc.
1. Prepare a detailed, rationale-first commit message for that step.

## Execution requirements

1. Treat `.copilot/prompts/tdd-phase-steps.md` as authoritative if any conflict appears.
1. Do not skip failing tests, lint/type/style/arch checks, or planning-doc status updates.
1. Keep scope to one step per cycle unless explicitly requested otherwise.
1. Keep edits minimal and behavior-preserving beyond the targeted step.
1. Default to focused validation for the touched files and tests; do not usually run full-suite commands such as `deno task test`, `deno task test_parallel`, `deno test -A`, or unscoped `deno test --allow-all`.
1. Use full-suite test commands only for exclusive cases: massive cross-cutting changes, changes that touch shared execution/runtime foundations with broad blast radius, or when the user explicitly requests a full run.

## Output format

1. Step selected and why.
1. RED evidence (failing test/check output summary).
1. GREEN evidence (passing test summary).
1. REFACTOR/CI gate results.
1. Planning document updates and commit payload.
