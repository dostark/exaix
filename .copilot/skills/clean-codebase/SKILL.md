---
name: clean-codebase
agent: general
tools:
  - run_command
  - read_file
  - patch_file
  - write_file
  - search_files
scope: dev
title: "Clean Codebase Skill (#clean-codebase)"
description: Drive the entire codebase to a fully green CI state — type errors, lint, fmt, style, arch, magic, duplication — with zero violations
short_summary: "Multi-phase skill to eliminate all type errors, lint warnings, style violations, and CI failures from the repository."
version: "1.0"
topics: ["cleanup", "validation", "linting", "style", "qa", "ci", "architecture"]
qwen_skill: clean-codebase
---

```text
Key points
- Fix issues in dependency order: type errors → lint → fmt → style → arch → magic → duplication
- Make targeted, minimal changes — do not refactor behavior during a cleanup pass
- Validate with exact project commands after every fix batch
- Never mark complete until ALL checks report zero errors/warnings/violations
- Prefer running check scripts with file-scope flags to get faster feedback loops
- When the scope involves more than ~20 files, work in batches of 5–10: read a batch, record findings, then continue

Canonical prompt (short):
"Drive the repository to fully green CI. Fix all type errors, lint issues,
formatting violations, style checker failures, architecture groundedness issues,
and magic-value violations. Zero tolerance for warnings or violations in the
final state."

Workflow
────────
Phase 1 — Baseline measurement
  1. Run each check in sequence and record all failures:
       deno check src/main.ts                          → list type errors
       deno lint                                        → list lint violations
       deno fmt --check                                 → list formatting diffs
       deno task check:style                            → list style violations
       deno task check:arch                             → list UNGROUNDED files
       deno task check:magic                            → count magic violations
       deno run -A scripts/measure_duplication.ts       → duplication %
  2. Tally totals: N type errors, N lint, N fmt, N style, N UNGROUNDED, N magic, duplication X%.
  3. Do NOT attempt all fixes at once — process one category per batch.

Phase 2 — Type errors (highest priority)
  4. Fix every error reported by `deno check src/main.ts`.
     - Remove `any` types; replace with specific interfaces or `unknown`.
     - Resolve missing module errors (TS2307) by creating stubs or fixing imports.
     - Never cast to `as any` to silence type errors.
  5. Re-run `deno check src/main.ts` — must report 0 errors before continuing.

Phase 3 — Lint
  6. Fix every violation reported by `deno lint`.
     - Prefer fixing the root cause over `// deno-lint-ignore` suppressions.
     - If suppression is the only option, add an inline comment explaining why.
  7. Re-run `deno lint` — 0 errors, 0 warnings.

Phase 4 — Formatting
  8. Run `deno fmt` to apply all formatting fixes automatically.
  9. Run `deno fmt --check` — must pass with no diffs.

Phase 5 — Style checker
 10. Fix every violation from `deno task check:style`:
     - Interface naming: class Foo → interface IFoo (check:style enforces this)
     - No raw string/number literal type unions (use ICodeConvention["field"])
     - Module boundary violations
 11. Re-run `deno task check:style` — 0 violations.

Phase 6 — Architecture groundedness
 12. Fix every UNGROUNDED file reported by `deno task check:arch`:
     - Add or correct the module-header JSDoc block with @module, @path, @description,
       @architectural-layer, @dependencies, @related-files.
 13. Re-run `deno task check:arch` — 0 UNGROUNDED files.

Phase 7 — Magic values
 14. If magic violation count is non-trivial (> 5), use #refactor-check-magic.
     For small counts: extract literals into named constants per guidelines.
 15. Re-run `deno task check:magic` — confirm reduction (target: minimize, ideally 0).

Phase 8 — Duplication (if threshold breached)
 16. If `measure_duplication.ts` reports > 2%, identify the top duplication clusters.
 17. Extract common code into shared utilities. Do NOT over-abstract — only extract
     when the duplication is identical behavior, not just similar-looking code.
 18. Re-run `measure_duplication.ts` — below 2% threshold.

Phase 9 — Agent docs validation
 19. Validate all `.copilot/` documentation meets schema requirements:
       deno run -A scripts/validate_agents_docs.ts
     This checks every `.copilot/` Markdown file for required frontmatter keys,
     'Canonical prompt', and 'Examples' sections. Fix any reported violations
     before proceeding.

Phase 10 — Final full-suite validation
 20. Run the complete CI pipeline to confirm all gates green:
       deno run -A scripts/ci.ts all
     Or manually:
       deno check src/main.ts && deno lint && deno fmt --check &&
       deno task check:style && deno task check:arch && deno task check:magic &&
       deno task test && deno run -A scripts/measure_coverage.ts
     Coverage thresholds: Line ≥ 70%, Branch ≥ 60%.
 21. All checks must report zero errors/warnings/violations before committing.

Commit
 22. Use #commit for the structured commit body. Subject example:
       chore: drive codebase to fully green CI (N violations fixed)

       what: fixed N type errors, N lint, N style, N UNGROUNDED files, magic reduced
       rationale: CI must be green before next feature phase
       tests: full suite N/N passing, coverage line X% branch Y%
       who: <agent identity>
       impact: repository-wide cleanup, no behavior changes

       CI gates: lint OK, type-check OK, style 0 errors, arch N GROUNDED, magic OK, dup OK

Do / Don't
- ✅ Do fix in dependency order (type errors first — they cascade into other failures)
- ✅ Do run the specific check after each fix batch before moving to the next phase
- ✅ Do prefer fixing root cause over suppression annotations
- ✅ Do run `deno task test` AFTER all other checks to confirm no regressions
- ✅ Do keep changes behavioral-neutral (cleanup only, no feature changes)
- ❌ Don't use `as any` to silence type errors
- ❌ Don't skip intermediate validations and only run the full suite at the end
- ❌ Don't refactor or restructure code during a cleanup pass
- ❌ Don't commit until every check reports zero violations
- ❌ Don't suppress lint rules without a documented reason

Related skills
- #refactor-check-magic — Run when magic violation count is non-trivial (> 5)
- #fix-bug              — For any regression introduced by a cleanup fix
- #next-steps           — When cleanup is one gated step in a phase plan
- #commit               — Create a structured commit message after cleanup

Workflow chain (typical):
  **#clean-codebase** → #commit
```

## Related

- [CODE_STYLE.md](../../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules

## Output format

1. Baseline tallies (type errors, lint, fmt, style, arch, magic, duplication).
1. Fix log: per-phase — what was fixed, file/line.
1. Intermediate check results after each phase (0 errors confirmed).
1. Final `scripts/ci.ts all` output: all gates green.
1. Commit payload.

## Examples

- `#clean-codebase` — drive the full repo to CI-green from scratch
- `#clean-codebase src/services/` — scope cleanup to the services layer only
- `#clean-codebase after merge — fix type errors and lint introduced by the merge`
