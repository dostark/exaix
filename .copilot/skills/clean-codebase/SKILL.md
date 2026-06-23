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
version: "1.0.0"
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
- Edition awareness: `deno task` wrappers (check, lint, fmt) already include `packages-team/` automatically.
  For edition-scoped cleanups, use `deno task ci:solo` or `deno task ci:team` instead of raw commands.

Canonical prompt (short):
"Drive the repository to fully green CI. Fix all type errors, lint issues,
formatting violations, style checker failures, architecture groundedness issues,
and magic-value violations. Zero tolerance for warnings or violations in the
final state."

Workflow
────────
Phase 1 — Baseline measurement
  1. Run each check in sequence and record all failures:
       deno task check                                   → list type errors (includes packages-team/)
       deno lint                                         → list lint violations (includes packages-team/)
       deno fmt --check                                  → list formatting diffs (includes packages-team/)
       deno task check:style                             → list style violations
       deno task check:no-edition-conditionals            → list edition-conditional violations outside allowed dirs
       deno task check:arch                              → list UNGROUNDED files (includes packages-team/)
       deno task check:magic                             → count magic violations
       deno run -A scripts/measure_duplication.ts        → duplication % per category
       deno task check:complexity                        → list functions above threshold
       deno task check:tool-result-parity                → tool manifest ↔ handler parity
       deno task docs-agent-validate                     → agent doc schema validation
  2. Tally totals: N type errors, N lint, N fmt, N style, N edition-conditional,
     N UNGROUNDED, N magic, duplication X/Y/Z%, complexity breaches.
  3. Do NOT attempt all fixes at once — process one category per batch.

  Edition note: All `deno task` commands above already include `packages-team/`. The `check:style`
  script has an `edition-conditional-outside-composer` rule that forbids `EXAIX_EDITION` /
  `edition ===` conditionals outside these allowed paths:
    - `packages-team/`, `apps/daemon/`, `apps/exactl/`, `tests/`, `scripts/ci.ts`, `scripts/test_parallel.ts`
    - `tests/scenario_framework/runner/modes.ts`, `.github/`, `exaix-enterprise/`
  If a cleanup introduces an edition conditional in a path not in this list, the style check will fail.

Phase 2 — Type errors (highest priority)
  4. Fix every error reported by `deno task check`.
     - Remove `any` types; replace with specific interfaces or `unknown`.
     - Resolve missing module errors (TS2307) by creating stubs or fixing imports.
     - Never cast to `as any` to silence type errors.
     - Note: `deno task check` includes packages-team/ (use `deno check packages/ apps/ tests/` for Solo-only scope).
  5. Re-run `deno task check` — must report 0 errors before continuing.

Phase 3 — Lint
  6. Fix every violation reported by `deno lint`.
     - Prefer fixing the root cause over `// deno-lint-ignore` suppressions.
     - If suppression is the only option, add an inline comment explaining why.
     - Note: `deno lint` includes packages-team/ by default via deno.json task definition.
  7. Re-run `deno lint` — 0 errors, 0 warnings.

Phase 4 — Formatting
  8. Run `deno fmt` to apply all formatting fixes automatically.
  9. Run `deno fmt --check` — must pass with no diffs.

Phase 5 — Style checker
 10. Fix every violation from `deno task check:style`:
     - Interface naming: class Foo → interface IFoo (check:style enforces this)
     - No raw string/number literal type unions (use ICodeConvention["field"])
     - Module boundary violations
     - Edition-conditional-outside-composer: `EXAIX_EDITION` / `edition ===` only in allowed paths (see Phase 1)
 11. Re-run `deno task check:style` — 0 violations.

Phase 6 — Architecture groundedness
 12. Fix every UNGROUNDED file reported by `deno task check:arch`:
     - Add or correct the module-header JSDoc block with @module, @path, @description,
       @architectural-layer, @dependencies, @related-files.
     - Files under `packages-team/` are already scanned by check:arch and share the same
       grounding requirements as `packages/`. Files tagged `@ungrounded` are exempted.
     - For packages-team only: if a file belongs to a Team-specific package and should not
       be grounded (no ARCHITECTURE.md reference), add the `@ungrounded` tag to the JSDoc header.
 13. Re-run `deno task check:arch` — 0 UNGROUNDED files.

Phase 7 — Magic values
 14. If magic violation count is non-trivial (> 5), use #refactor-check-magic.
     For small counts: extract literals into named constants per guidelines.
 15. Re-run `deno task check:magic` — confirm reduction (target: minimize, ideally 0).

Phase 8 — Duplication (if threshold breached)
 16. Run `deno run -A scripts/measure_duplication.ts` — checks three categories:
     - Source (packages/, packages-team/, apps/): threshold 2%
     - Tests (tests/): threshold 3%
     - Integration tests (tests/integration/, tests/scenario_framework/): threshold 3%
 17. If any category exceeds threshold, identify the top duplication clusters and
     extract common code into shared utilities. Do NOT over-abstract — only extract
     when the duplication is identical behavior, not just similar-looking code.
 18. Re-run `measure_duplication.ts` — all three categories must pass.

Phase 9 — Code complexity (if threshold breached)
 19. Run `deno task check:complexity` — verifies no function exceeds cyclomatic
     complexity of 15 (--threshold 15 --fail). Scans packages/, packages-team/, apps/.
 20. If violations found, refactor over-complex functions by splitting into smaller
     single-responsibility functions. Keep behavioral changes to zero.
 21. Re-run `deno task check:complexity` — must exit 0 with "Complexity matches expectations."

Phase 10 — Edition-conditional compliance
 22. Run `deno task check:no-edition-conditionals` — verifies `EXAIX_EDITION` references
     only appear in edition-aware directories (apps/common, packages-team, exaix-enterprise,
     scripts, .github, apps/daemon, apps/exactl, tests/). Any violation outside these paths
     must be fixed by moving edition logic to an edition-composer or a script boundary.

Phase 11 — Tool result parity
 23. Run `deno task check:tool-result-parity` — verifies that TOOL_MANIFEST metadata
     is consistent with the actual tool handler schemas across all edition layers.

Phase 12 — Agent docs validation
 24. Validate all `.copilot/` documentation meets schema requirements:
        deno task docs-agent-validate
      This runs a comprehensive check covering:
      - Markdown formatting of `*.md` files
      - Internal and external link validity
      - Cross-reference consistency
      - Required frontmatter keys, 'Canonical prompt', and 'Examples' sections
      - Manifest freshness (`deno task check:docs`)

Phase 13 — Final full-suite validation
 25. Run tests to confirm all gates green. Choose the edition-scoped command:
         # Full (all editions — slowest)
         deno task test_parallel
         # Solo-only (excludes packages-team/)
         deno task test:solo && deno task test:security
         # Team edition (includes packages-team/)
         deno task test:team
         # CI pipeline (edition-aware)
         deno task ci:solo    # Solo checks + Solo tests
         deno task ci:team    # Team checks + Team tests
      Or validate every gate sequentially:
         deno task check && deno lint && deno fmt --check &&
         deno task check:style && deno task check:no-edition-conditionals &&
         deno task check:arch && deno task check:magic &&
         deno task check:tool-result-parity && deno task docs-agent-validate &&
         deno run -A scripts/measure_duplication.ts &&
         deno task check:complexity &&
         deno task test:solo
 26. All checks must report zero errors/warnings/violations before committing.

Commit
 27. Use #commit for the structured commit body. Subject example:
        chore: drive codebase to fully green CI (N violations fixed)

        what: fixed N type errors, N lint, N style, N UNGROUNDED files, magic reduced,
              duplication below threshold, complexity matches expectations
        rationale: CI must be green before next feature phase
        tests: full suite N/N passing, coverage line X% branch Y%
        who: <agent identity>
        impact: repository-wide cleanup, no behavior changes

        CI gates: lint OK, type-check OK, style 0 errors, edition-conditionals OK,
                  arch N GROUNDED, magic OK, duplication X%, complexity OK

Do / Don't
- ✅ Do fix in dependency order (type errors first — they cascade into other failures)
- ✅ Do run the specific check after each fix batch before moving to the next phase
- ✅ Do prefer fixing root cause over suppression annotations
- ✅ Do run `deno task test:solo` (or `test:team`) AFTER all other checks to confirm no regressions
- ✅ Do keep changes behavioral-neutral (cleanup only, no feature changes)
- ✅ Do use `deno task` wrappers instead of raw `deno check/lint/fmt` — they automatically include `packages-team/`
- ✅ Do verify edition-conditional placement when touching edition-aware code
- ❌ Don't use `as any` to silence type errors
- ❌ Don't skip intermediate validations and only run the full suite at the end
- ❌ Don't refactor or restructure code during a cleanup pass
- ❌ Don't commit until every check reports zero violations
- ❌ Don't suppress lint rules without a documented reason
- ❌ Don't add `EXAIX_EDITION` conditionals outside allowed paths — use edition-composer instead

Related skills
- #refactor-check-magic — Run when magic violation count is non-trivial (> 5)
- #fix-bug              — For any regression introduced by a cleanup fix
- #next-steps           — When cleanup is one gated step in a phase plan
- #commit               — Create a structured commit message after cleanup
- #edition-development  — When the cleanup touches edition-separation logic (composers, seam wiring)

Workflow chain (typical):
  **#clean-codebase** → #commit
```

## Related

- [LLM_GUIDE.md](../../../LLM_GUIDE.md) — universal behavioral guidelines (think before coding, simplicity, surgical changes, goal-driven execution)
- [CODE_STYLE.md](../../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules

## Output format

1. Baseline tallies (type errors, lint, fmt, style, arch, magic, duplication per category, complexity breaches).
1. Fix log: per-phase — what was fixed, file/line.
1. Intermediate check results after each phase (0 errors confirmed).
1. Final `deno task test_parallel` output: all gates green.
1. Commit payload.

## Examples

- `#clean-codebase` — drive the full repo to CI-green from scratch
- `#clean-codebase packages/` — scope cleanup to the packages layer only
- `#clean-codebase after merge — fix type errors and lint introduced by the merge`

---
exaix:
  skill_id: clean-codebase
  triggers:
    keywords: [clean-codebase, ci-green, cleanup, fix-all, sweep]
    task_types: [chore, refactor]
    tags: [cleanup, ci]
  constraints:
    - "Fix in dependency order: type errors first (they cascade)"
    - "Run the specific check after each fix batch before moving to next phase"
    - "Prefer fixing root cause over suppression annotations"
    - "Keep changes behavioral-neutral — cleanup only, no feature changes"
    - "Do not use as any to silence type errors"
    - "Do not refactor or restructure code during a cleanup pass"
  output_requirements:
    - "Baseline tallies per gate (type errors, lint, fmt, style, arch, magic, duplication, complexity)"
    - "Fix log per phase — what was fixed, file:line"
    - "Intermediate check results after each phase (0 errors confirmed)"
    - "Final full-suite test output: all gates green"
  quality_criteria:
    - name: full_coverage
      description: All CI gates pass with zero violations
      weight: 40
    - name: root_cause_fix
      description: Fixes address root cause, not suppress symptoms
      weight: 30
    - name: behavioral_neutrality
      description: No behavioral changes introduced during cleanup
      weight: 30
---
