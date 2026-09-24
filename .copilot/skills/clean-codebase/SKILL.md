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
version: "1.3.0"
topics: ["cleanup", "validation", "linting", "style", "qa", "ci", "architecture"]
qwen_skill: clean-codebase
---

```text
Key points

- Fix in dependency order: type errors → lint → fmt → style → arch → magic → duplication.
- Targeted, minimal changes — no behavior refactors during cleanup.
- Validate with exact project commands after every fix batch.
- Not complete until ALL checks report zero errors/warnings/violations.
- Prefer file-scope flags for faster feedback.
- Scope > ~20 files: batches of 5–10. Read a batch, record findings, continue.
- Edition awareness: `deno task` check/lint/fmt already include `exaix-team/` — no edition
  scoping needed for static checks. Edition-scoped tests: `deno task test:solo` / `test:team`.
  Edition-scoped build: `deno task ci:solo --skip-tests` / `ci:team --skip-tests` (checks +
  build, no tests) instead of full `ci:solo`/`ci:team` (which re-runs the suite for coverage).
- `deno run -A scripts/ci.ts check` is ONE verified command covering the static gates as a
  true superset of the pre-commit hook (kept in sync by `tests/scripts/ci_wiring_test.ts`).
  Use it for a fast pass/fail. It does NOT cover `check:duplication`, `check:god-objects`,
  `check:leak-guard`, `check:no-edition-conditionals`, `check:version`,
  `check:unused-exports:strict` — run those separately (a nonzero unused-exports baseline
  is a Phase-1 finding to triage by hand).

Canonical prompt (short):
"Drive the repository to fully green CI. Fix all type errors, lint issues, formatting
violations, style checker failures, architecture groundedness issues, and magic-value
violations. Zero tolerance for warnings or violations in the final state."

Workflow
────────
Phase 1 — Baseline
  1. `deno task check` — type errors, module resolution, compilation. Fix all before proceeding.
  2. Run each check and record failures:
     deno lint; deno fmt --check; deno task check:style; check:test-placement;
     check:magic; check:no-edition-conditionals; check:arch; check:complexity;
     check:unused-exports:strict; check:duplication; check:tool-result-parity;
     check:skill-envelopes; check:manifests; check:hardcoded-models; check:event-strings;
     check:optional-params; check:leak-guard; check:docs; check:version (--dry-run);
     check:god-objects (advisory); check:edition-graph; check:runtime-artifacts;
     check:agent-docs-integrity; check:blueprint-integrity; check:skill-index;
     check:qwen-skills-sync; check:skill-ephemera; check:config-keys;
     check:event-coverage --fail-on-tagged; docs-bench; docs-agent-validate.
  3. Tally totals per category.
  4. Process one category per batch — never all at once.

  Edition note: `check:style`'s `edition-conditional-outside-composer` rule allows
  `EXAIX_EDITION`/`edition ===` only in: `exaix-team/`, `apps/daemon/`, `apps/exactl/`,
  `tests/`, `scripts/ci.ts`, `scripts/test_parallel.ts`,
  `tests/scenario_framework/runner/modes.ts`, `.github/`, `exaix-enterprise/`. A
  conditional elsewhere fails the style check.

Phase 2 — Type errors (highest priority)
  5. Fix every `deno task check` error: no `any` (use specific interfaces/`unknown`); fix
     TS2307 with stubs or imports; never `as any`. (`deno check packages/ apps/ tests/`
     for Solo-only scope.)
  6. Re-run `deno task check` — 0 errors.

Phase 3 — Lint
  7. Fix every `deno lint` violation at the root cause, not `// deno-lint-ignore`; a
     suppression needs an inline justification.
  8. Re-run `deno lint` — 0 errors, 0 warnings.

Phase 4 — Formatting
  9. `deno fmt`; then `deno fmt --check` — no diffs.

Phase 5 — Style
 11. Fix `deno task check:style`: interface naming (class Foo → IFoo); no raw literal type
     unions (use `ICodeConvention["field"]`); module boundaries; edition-conditional
     placement (Phase 1).
 12. Re-run — 0 violations.

Phase 6 — Architecture grounding
 13. Fix every `check:arch` UNGROUNDED file: add/correct the module-header JSDoc
     (@module, @path, @description, @architectural-layer, @dependencies, @related-files).
     `exaix-team/` files are scanned and grounded like `packages/`; a Team-only file that
     needs no grounding gets `@ungrounded`.
 14. Re-run — 0 UNGROUNDED.

Phase 7 — Magic values
 15. Count > 5 → run the #refactor check:magic & duplication pass; small counts → extract named constants.
 16. Re-run `check:magic` — target 0.

Phase 8 — Duplication
 17. `deno task check:duplication` (three categories, configured thresholds).
 18. Over threshold: extract common code into shared utilities — only identical behavior,
     not similar-looking code.
 19. Re-run — all three categories pass.

Phase 9 — Complexity
 20. `deno task check:complexity` (no function over cyclomatic 15).
 21. Split over-complex functions, zero behavior change.
 22. Re-run — "Complexity matches expectations."

Phase 10 — Edition conditionals
 23. `check:no-edition-conditionals` — `EXAIX_EDITION` only in edition-aware directories;
     move edition logic to a composer or script boundary.

Phase 11 — Tool result parity
 24. `check:tool-result-parity` — TOOL_MANIFEST matches handler schemas across editions.

Phase 12 — Stale markdown paths
 25. `check:md-path:staged` (enforced by CI + pre-commit ratchet) — stale paths and bare
     prose paths in staged markdown. The unscoped `check:md-path` sweep also covers the
     submodule's historical planning docs (phases 44–78 pre-package-extraction): that is
     pre-existing, intentionally unenforced drift — do NOT fix those ~3600 references.
 26. Fix stale paths (repoint or backtick), re-run — 0 violations.

Phase 13 — Test placement
 27. `check:test-placement` — every test file in its owning boundary.
 28. Fix mislocated files, re-run — 0 violations.

Phase 14 — Skill envelopes
 29. `check:skill-envelopes` — every `.copilot/skills/` SKILL.md has a valid `exaix:` block.
 30. Fix invalid envelopes (missing `---` separator, malformed YAML, missing fields), re-run.

Phase 15 — Step manifests
 31. `check:manifests` — every step in phase-NN-*.md (NN ≥ 130) has a valid step-manifest.
 32. Add/fix, re-run.

Phase 16 — Hardcoded model strings
 33. `check:hardcoded-models` — no hardcoded `provider:model` in non-test TS/Blueprints
     outside the allowlist.
 34. Fix via `HARDCODED_MODEL_ALLOWLIST` or a `ModelResolver`/config reference, re-run — 0.

Phase 17 — Event string hygiene
 35. `check:event-strings` — no inline event string literals.
 36. Extract to named constants, re-run.

Phase 18 — Optional parameter conventions
 37. `check:optional-params`. Note `--staged` (also run by the pre-commit hook/plan-step
     gate) is a FILE-LEVEL RATCHET: any bare `?`/`| undefined` param in a staged file
     fails, even unrelated to the edit. Wrap in `Opt<T, Reason.*>`
     (`import { Opt, Reason } from "@exaix/core/types"`); `Opt` unwraps transparently.
 38. Fix, re-run.

Phase 19 — Edition leak guard
 39. `check:leak-guard` — no edition-specific code in Solo paths.
 40. Fix, re-run.

Phase 20 — Manifest freshness
 41. `check:docs` — if stale, run `deno run -A scripts/build_agents_index.ts`, re-check.

Phase 21 — Version compliance
 42. `check:version --dry-run` — `WORKSPACE_SCHEMA_VERSION`/`BINARY_VERSION` current.
 43. Fix by bumping manually or `deno task bump`, re-check.

Phase 22 — Agent docs validation
 44. `docs-agent-validate` — markdown formatting, link validity, cross-references,
     frontmatter keys + Canonical prompt + Examples, manifest freshness.
 45. Fix, re-run — 0.

Phase 23 — Final full-suite validation
 46. Fastest path first:
     a. `deno run -A scripts/ci.ts check` — ONE command, all static gates (do NOT
        hand-chain `deno task check:X`; a second hand-maintained list is how gates went
        unchecked before centralization).
     b. Extras ci.ts misses: `check:duplication`, `check:god-objects`,
        `check:leak-guard`, `check:no-edition-conditionals`, `check:version --dry-run`.
     c. Tests: `deno task test_parallel` (all editions) / `deno task test:solo &&
        deno task test:security` (Solo) / `deno task test:team` (Team). Shortcut:
        `deno task ci:solo --skip-tests` / `ci:team --skip-tests` (= `scripts/ci.ts all
        --edition X --skip-tests`) runs (a) + build without Testing/Coverage. Drop
        `--skip-tests` only when a full pipeline/coverage validation was requested.
 47. All checks zero before committing.

Phase 24 — God objects (advisory)
 48. `check:god-objects` — classes > 300 lines scored on 6 metrics; reports candidates
     without failing CI.
 49. Score ≥ 50 → decompose per [refactor god-object](../refactor/SKILL.md#god-object-decomposition):
     extract cohesive services (own file, own tests, clear interface); the original
     becomes a thin orchestrator; TDD the service first.
 50. Re-run — target score < 50.

Phase 25 — Pre-commit-hook parity gates
 51. Fix directly from the script output (narrow, usually clean):
     `check:edition-graph` (higher-tier import reached the graph — move behind a composer);
     `check:runtime-artifacts` (staged venv/cache artifact — remove + .gitignore);
     `check:agent-docs-integrity` (dangling `.copilot/` reference — fix citation);
     `check:blueprint-integrity` (orphan Blueprint reference — resolve/remove);
     `check:skill-index` (run without `--check` to regenerate);
     `check:qwen-skills-sync` (add/update the missing qwen_skill entry);
     `check:config-keys` (two `configurable()` same key — rename; CODE_STYLE.md §2);
     `check:event-coverage --fail-on-tagged` (`@visible` gap — add the DomainEventType or
     verify by hand, see #post-gap-analysis Phase 6);
     `docs-bench` (doc drifted from encoded ground truth — fix the doc, not the test).
 52. Re-run `deno run -A scripts/ci.ts check` — all clean.

Commit
 53. Use #commit. Subject: `chore: drive codebase to fully green CI (N violations fixed)`.
     Fields: what:, rationale:, tests:, who:, impact:.

Do / Don't
- ✅ Fix in dependency order (type errors cascade).
- ✅ Run `deno task check` first.
- ✅ Run the specific check after each fix batch.
- ✅ Fix root cause over suppression.
- ✅ Run `deno task test:solo` (or `test:team`) after all other checks.
- ✅ Run `deno run -A scripts/ci.ts check` before the final commit instead of hand-chaining.
- ✅ Keep changes behavioral-neutral.
- ✅ Use `deno task` wrappers (they include `exaix-team/`).
- ✅ Verify edition-conditional placement in edition-aware code.
- ❌ `as any` to silence type errors.
- ❌ Skip intermediate validations and only run the suite at the end.
- ❌ Refactor/restructure during cleanup.
- ❌ Commit until every check reports zero violations.
- ❌ Suppress lint rules without a documented reason.
- ❌ Add `EXAIX_EDITION` conditionals outside allowed paths — use edition-composer.

Related: #refactor (check:magic & duplication pass, god-object decomposition);
#fix-bug (regressions); #next-steps (cleanup as a gated step); #commit;
#edition-development (edition-separation cleanup).

Workflow chain: **#clean-codebase** → #commit
```

## Related

- [AGENTS.md](../../../AGENTS.md#behavioral-guidelines) — behavioral guidelines
- [CODE_STYLE.md](../../../CODE_STYLE.md) — naming, type, import, constants rules

## See also

- [exaix-development](../exaix-development/SKILL.md) — code patterns, config constants, anti-patterns
- [test-development](../test-development/SKILL.md) — test placement, helpers for integration tests

## Output format

1. Baseline tallies per gate.
1. Fix log: per phase — what was fixed, file/line.
1. Intermediate check results after each phase (0 errors).
1. Final `deno task test_parallel` output: all gates green.
1. Commit payload.

## Examples

- `#clean-codebase` — drive the full repo to CI-green from scratch
- `#clean-codebase packages/` — scope cleanup to the packages layer only
- `#clean-codebase after merge — fix type errors and lint introduced by the merge`

---
exaix:
  skill_id: clean-codebase
  related_skills: [exaix-development, test-development]
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
