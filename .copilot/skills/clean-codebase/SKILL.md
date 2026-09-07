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
- Fix issues in dependency order: type errors → lint → fmt → style → arch → magic → duplication
- Make targeted, minimal changes — do not refactor behavior during a cleanup pass
- Validate with exact project commands after every fix batch
- Never mark complete until ALL checks report zero errors/warnings/violations
- Prefer running check scripts with file-scope flags to get faster feedback loops
- When the scope involves more than ~20 files, work in batches of 5–10: read a batch, record findings, then continue
- Edition awareness: `deno task` wrappers (check, lint, fmt) already include `exaix-team/`
  automatically — static checks never need edition scoping. For an edition-scoped test run,
  use `deno task test:solo` / `deno task test:team` directly. For an edition-scoped BUILD,
  use `deno task ci:solo --skip-tests` / `deno task ci:team --skip-tests` (checks + build,
  no tests, fast) rather than the full `ci:solo`/`ci:team` (which also re-runs the whole
  suite a second time for coverage).
- `deno run -A scripts/ci.ts check` is a verified single command covering 28 static
  gates as a true superset of the real pre-commit hook (kept in sync via
  `tests/scripts/ci_wiring_test.ts` — Phase 168 self-improvement-retro); use it for a
  fast pass/fail signal before or between phases. It does NOT cover this skill's own
  deeper categories — `check:duplication`, `check:god-objects`, `check:leak-guard`,
  `check:no-edition-conditionals`, `check:version`, `check:unused-exports:strict` — those
  still need their own runs (Phases 8, 10, 17, 19, 22 below; `unused-exports:strict` has
  no dedicated fix phase yet — treat a nonzero baseline count as a Phase 1 finding to
  triage by hand).

Canonical prompt (short):
"Drive the repository to fully green CI. Fix all type errors, lint issues,
formatting violations, style checker failures, architecture groundedness issues,
and magic-value violations. Zero tolerance for warnings or violations in the
final state."

Workflow
────────
Phase 1 — Baseline measurement
  1. Run `deno task check` first — this catches type errors, module resolution,
     and any compilation issues. Fix all type errors before proceeding.
  2. Run each remaining check in sequence and record all failures:
       deno lint                                         → list lint violations (includes exaix-team/)
       deno fmt --check                                  → list formatting diffs (includes exaix-team/)
       deno task check:style                             → list style violations
       deno task check:test-placement                    → mislocated test files
       deno task check:magic                             → count magic violations
       deno task check:no-edition-conditionals            → edition-conditional violations outside allowed dirs
       deno task check:arch                              → list UNGROUNDED files (includes exaix-team/)
       deno task check:complexity                        → list functions above threshold
       deno task check:unused-exports:strict              → dead/unwired exports (CI grade)
       deno task check:duplication                       → duplication % per category
       deno task check:tool-result-parity                → tool manifest ↔ handler parity
       deno task check:skill-envelopes                   → exaix block validity in .copilot/skills/
       deno task check:manifests                         → step-manifest validity in phase plan docs
       deno task check:hardcoded-models                  → hardcoded provider:model strings in TS + Blueprints
       deno task check:event-strings                     → inline event string literals
       deno task check:optional-params                   → optional parameter conventions
       deno task check:leak-guard                        → edition leak guard
       deno task check:docs                              → manifest freshness
       deno task check:version                           → version bump compliance (dry-run: --dry-run)
       deno task check:god-objects                       → god object candidates (advisory)
       deno task check:edition-graph                      → edition-leak graph gate (deno-info double-check)
       deno task check:runtime-artifacts                  → committed venv/__pycache__/node_modules-style artifacts
       deno task check:agent-docs-integrity                → dangling references in the .copilot/ corpus
       deno task check:blueprint-integrity                 → Blueprint catalog agent-role/flow/skill resolution
       deno task check:skill-index                         → Memory/Skills ↔ Blueprints/Skills sync
       deno task check:qwen-skills-sync                    → .qwen/settings.json ↔ .copilot/skills/ sync
       deno task check:config-keys                         → duplicate configurable() key collisions
       deno task check:event-coverage --fail-on-tagged     → @visible-tagged classes with a coverage gap
       deno task docs-bench                                → hallucination-benchmark doc/ground-truth drift
       deno task docs-agent-validate                     → agent doc schema validation
  3. Tally totals: N type errors, N lint, N fmt, N style, N edition-conditional,
     N UNGROUNDED, N magic, duplication X/Y/Z%, complexity breaches.
  4. Do NOT attempt all fixes at once — process one category per batch.

  Edition note: All `deno task` commands above already include `exaix-team/`. The `check:style`
  script has an `edition-conditional-outside-composer` rule that forbids `EXAIX_EDITION` /
  `edition ===` conditionals outside these allowed paths:
    - `exaix-team/`, `apps/daemon/`, `apps/exactl/`, `tests/`, `scripts/ci.ts`, `scripts/test_parallel.ts`
    - `tests/scenario_framework/runner/modes.ts`, `.github/`, `exaix-enterprise/`
  If a cleanup introduces an edition conditional in a path not in this list, the style check will fail.

Phase 2 — Type errors (highest priority)
  5. Fix every error reported by `deno task check` (Phase 1 step 1).
     - Remove `any` types; replace with specific interfaces or `unknown`.
     - Resolve missing module errors (TS2307) by creating stubs or fixing imports.
     - Never cast to `as any` to silence type errors.
     - Note: `deno task check` includes exaix-team/ (use `deno check packages/ apps/ tests/` for Solo-only scope).
  6. Re-run `deno task check` — must report 0 errors before continuing.

Phase 3 — Lint
  7. Fix every violation reported by `deno lint`.
     - Prefer fixing the root cause over `// deno-lint-ignore` suppressions.
     - If suppression is the only option, add an inline comment explaining why.
     - Note: `deno lint` includes exaix-team/ by default via deno.json task definition.
  8. Re-run `deno lint` — 0 errors, 0 warnings.

Phase 4 — Formatting
  9. Run `deno fmt` to apply all formatting fixes automatically.
  10. Run `deno fmt --check` — must pass with no diffs.

Phase 5 — Style checker
 11. Fix every violation from `deno task check:style`:
     - Interface naming: class Foo → interface IFoo (check:style enforces this)
     - No raw string/number literal type unions (use ICodeConvention["field"])
     - Module boundary violations
     - Edition-conditional-outside-composer: `EXAIX_EDITION` / `edition ===` only in allowed paths (see Phase 1)
 12. Re-run `deno task check:style` — 0 violations.

Phase 6 — Architecture groundedness
  13. Fix every UNGROUNDED file reported by `deno task check:arch`:
     - Add or correct the module-header JSDoc block with @module, @path, @description,
       @architectural-layer, @dependencies, @related-files.
     - Files under `exaix-team/` are already scanned by check:arch and share the same
       grounding requirements as `packages/`. Files tagged `@ungrounded` are exempted.
     - For exaix-team only: if a file belongs to a Team-specific package and should not
       be grounded (no ARCHITECTURE.md reference), add the `@ungrounded` tag to the JSDoc header.
  14. Re-run `deno task check:arch` — 0 UNGROUNDED files.

Phase 7 — Magic values
  15. If magic violation count is non-trivial (> 5), use #refactor-check-magic.
     For small counts: extract literals into named constants per guidelines.
  16. Re-run `deno task check:magic` — confirm reduction (target: minimize, ideally 0).

Phase 8 — Duplication (if threshold breached)
  17. Run `deno task check:duplication` — checks three categories with configured thresholds.
  18. If any category exceeds threshold, identify the top duplication clusters and
     extract common code into shared utilities. Do NOT over-abstract — only extract
     when the duplication is identical behavior, not just similar-looking code.
  19. Re-run `deno task check:duplication` — all three categories must pass.

Phase 9 — Code complexity (if threshold breached)
  20. Run `deno task check:complexity` — verifies no function exceeds cyclomatic
     complexity of 15 (--threshold 15 --fail). Scans packages/, exaix-team/, apps/.
  21. If violations found, refactor over-complex functions by splitting into smaller
     single-responsibility functions. Keep behavioral changes to zero.
  22. Re-run `deno task check:complexity` — must exit 0 with "Complexity matches expectations."

Phase 10 — Edition-conditional compliance
  23. Run `deno task check:no-edition-conditionals` — verifies `EXAIX_EDITION` references
     only appear in edition-aware directories (apps/common, exaix-team, exaix-enterprise,
     scripts, .github, apps/daemon, apps/exactl, tests/). Any violation outside these paths
     must be fixed by moving edition logic to an edition-composer or a script boundary.

Phase 11 — Tool result parity
  24. Run `deno task check:tool-result-parity` — verifies that TOOL_MANIFEST metadata
     is consistent with the actual tool handler schemas across all edition layers.

Phase 12 — Stale markdown paths
   25. Run `deno task check:md-path:staged` — the enforceable gate (CI + pre-commit ratchet)
      scans staged markdown for references to files that do not exist (stale paths) and
      bare prose paths that should be backtick-wrapped. The un-scoped `check:md-path`
      full sweep additionally covers the exaix-dev-docs submodule's historical planning
      docs (phases 44–78 pre-package-extraction paths): those are pre-existing,
      intentionally unenforced drift — do NOT "fix" ~3600 legacy references there as part
      of a cleanup pass.
   26. Fix stale paths (repoint or wrap in backticks), then re-run `deno task check:md-path:staged` — 0 violations.

Phase 13 — Test placement
   27. Run `deno task check:test-placement` — verifies every test file is in its owning
      boundary (package-owned, app-owned, or cross-cutting root tests/).
   28. Fix mislocated test files, then re-run `deno task check:test-placement` — 0 violations.

Phase 14 — Skill envelope validity
  27. Run `deno task check:skill-envelopes` — validates that every `.copilot/skills/` SKILL.md
     has a valid `exaix:` block matching `SkillEnvelopeSchema`.
  28. Fix invalid envelopes (missing `
## See also

- [exaix-development](../exaix-development/SKILL.md) — code patterns, config constants, anti-patterns
- [test-development](../test-development/SKILL.md) — test placement, helpers for integration tests
---` separator, malformed YAML, missing fields),
     then re-run until 0 errors.

Phase 14 — Step-manifest CI gate
  29. Run `deno task check:manifests` — validates that every step in phase-NN-*.md (NN ≥ 130)
     has a valid step-manifest fenced YAML block.
  30. Add missing or fix invalid manifests, re-run until 0 errors.

Phase 14b — Hardcoded model strings

  31. Run `deno task check:hardcoded-models` — scans non-test TS source and Blueprints `.md` files for
      hardcoded `provider:model` strings outside the allowlist.
  32. Fix violations by either adding the model to `HARDCODED_MODEL_ALLOWLIST` or replacing with a
      `ModelResolver` call / config reference.
  33. Re-run `deno task check:hardcoded-models` — must exit 0.

Phase 15 — Event string hygiene
  31. Run `deno task check:event-strings` — verifies no inline event string literals exist.
  32. Extract any inline event strings into named constants, re-run until 0 violations.

Phase 16 — Optional parameter conventions
  33. Run `deno task check:optional-params` — verifies optional parameters follow conventions.
  34. Fix violations, re-run until 0 errors.

Phase 17 — Edition leak guard
  35. Run `deno task check:leak-guard` — verifies no edition-specific code leaks into
     Solo edition paths.
  36. Fix violations, re-run until 0 errors.

Phase 18 — Manifest freshness
  37. Run `deno task check:docs` — verifies `.copilot/manifest.json` is up-to-date.
     If stale, re-run `deno run -A scripts/build_agents_index.ts` then re-check.

Phase 19 — Version compliance
  38. Run `deno task check:version --dry-run` — verifies version constants (`WORKSPACE_SCHEMA_VERSION`,
     `BINARY_VERSION`) are up-to-date with staged changes.
  39. If violations found, either bump versions manually or run `deno task bump`, then re-check.

Phase 20 — Agent docs validation
  40. Run `deno task docs-agent-validate` — validates all `.copilot/` documentation:
     - Markdown formatting of `*.md` files
     - Internal and external link validity
     - Cross-reference consistency
     - Required frontmatter keys, 'Canonical prompt', and 'Examples' sections
     - Manifest freshness (double-checked via `check:docs`)
  41. Fix any violations, re-run until 0 errors/warnings.

Phase 21 — Final full-suite validation
  42. Confirm every static gate is clean, fastest path first:
      a. `deno run -A scripts/ci.ts check` — one verified command covering 28 static
         gates (type-check, lint, fmt, style, arch, magic, event-coverage, and every
         other real pre-commit gate; see Key Points above). Do NOT hand-chain the
         individual `deno task check:X` commands instead — a second, separately
         maintained copy of that list is exactly how 9 of them silently went unchecked
         here before the Phase 168 alignment.
      b. Run this skill's extras ci.ts does not cover: `deno task check:duplication`,
         `deno task check:god-objects`, `deno task check:leak-guard`,
         `deno task check:no-edition-conditionals`, `deno task check:version --dry-run`.
      c. Run tests — choose the edition-scoped command:
         # Full (all editions — slowest)
         deno task test_parallel
         # Solo-only (excludes exaix-team/)
         deno task test:solo && deno task test:security
         # Team edition (includes exaix-team/)
         deno task test:team
      Shortcut: `deno task ci:solo --skip-tests` / `deno task ci:team --skip-tests`
      (== `scripts/ci.ts all --edition <X> --skip-tests`) runs 42a + build in one
      edition-scoped command, skipping the slow Testing+Coverage phases — use this as the
      default local shortcut instead of 42a-42c individually. Only drop `--skip-tests`
      (running the full `ci:solo`/`ci:team`, which re-runs the whole suite a SECOND time
      for coverage plus a full build) when the user's prompt explicitly asked for a full
      pipeline/coverage validation, not for a routine cleanup pass. Either way, still run
      42b's extras separately (`ci:solo`/`ci:team` don't cover them).
  43. All checks must report zero errors/warnings/violations before committing.

Phase 22 — God object detection (advisory)
  44. Run `deno task check:god-objects` — scans all classes with > 300 lines
      and scores them on 6 metrics (line count, method count, constructor params,
      max method length, import count, field count). Reports candidates without
      failing CI.
  45. For each candidate with score ≥ 50, evaluate decomposition using the
      [refactor skill](../refactor/SKILL.md#god-object-decomposition):
      - Extract cohesive sub-domains into separate services
      - Each service gets its own file, its own test suite, and a clear interface
      - The original class becomes a thin orchestrator that delegates to services
      - Use TDD: write service tests before implementing the service
  46. Re-run `deno task check:god-objects` to verify score reduction.
      Target: score < 50 for all classes.

Phase 23 — Additional pre-commit-hook parity gates
  47. These 9 gates block the real pre-commit hook but had no coverage anywhere in this
      skill before the Phase 168 ci.ts alignment; each is narrow and typically clean, so
      fix directly from the script's own error output rather than a dedicated sub-phase:
      - `check:edition-graph` — a static higher-tier import reached the resolved dependency
        graph; move the import behind an edition-composer boundary.
      - `check:runtime-artifacts` — a staged file is (or embeds) a venv/__pycache__/
        node_modules-style artifact; remove it and add/verify a .gitignore entry.
      - `check:agent-docs-integrity` — a dangling reference inside the `.copilot/` corpus;
        fix the citation or the file it points to.
      - `check:blueprint-integrity` — an orphan agent-role/skill/flow in `Blueprints/`;
        resolve the dangling reference or remove the orphan.
      - `check:skill-index` — `Memory/Skills` is out of sync with `Blueprints/Skills`;
        run `deno task check:skill-index` without `--check` to regenerate.
      - `check:qwen-skills-sync` — `.qwen/settings.json` is out of sync with a
        `.copilot/skills/` `qwen_skill` declaration; add/update the missing entry.
      - `check:config-keys` — two `configurable()` calls declared the same key; rename
        one (see CODE_STYLE.md §2).
      - `check:event-coverage --fail-on-tagged` — an `@visible`-tagged class has a
        coverage gap; add the missing `DomainEventType` call or verify by hand and
        adjust the class if the finding is a false positive (see #post-gap-analysis
        Phase 6 for the by-hand verification method).
      - `docs-bench` — a hallucination-benchmark assertion in `tests/docs/` failed;
        the doc drifted from the ground truth the test encodes — fix the doc, not the test.
  48. Re-run `deno run -A scripts/ci.ts check` to confirm all 9 (plus every other static
      gate) are clean in one pass.

Commit
  44. Use #commit for the structured commit body. Subject example:
        chore: drive codebase to fully green CI (N violations fixed)

        what: fixed N type errors, N lint, N style, N test-placement, N UNGROUNDED,
              N magic, N edition-conditional, N event-strings, N optional-params,
              N leak-guard, N skill-envelopes, N manifests; duplication below threshold,
              complexity matches expectations
        rationale: CI must be green before next feature phase
        tests: full suite N/N passing, coverage line X% branch Y%
        who: <agent identity>
        impact: repository-wide cleanup, no behavior changes

        CI gates: `deno run -A scripts/ci.ts check` clean (28 gates, incl. edition-graph,
                  runtime-artifacts, agent-docs-integrity, blueprint-integrity,
                  skill-index, qwen-skills-sync, config-keys, event-coverage, docs-bench);
                  duplication X%, god-objects OK, leak-guard OK, no-edition-conditionals OK,
                  version OK, complexity OK

Do / Don't
- ✅ Do fix in dependency order (type errors first — they cascade into other failures)
- ✅ Do run `deno task check` as the very first step — type errors are highest priority
- ✅ Do run the specific check after each fix batch before moving to the next phase
- ✅ Do prefer fixing root cause over suppression annotations
- ✅ Do run `deno task test:solo` (or `test:team`) AFTER all other checks to confirm no regressions
- ✅ Do run `deno run -A scripts/ci.ts check` before the final commit (Phase 21, step 42a) instead of hand-chaining individual `deno task check:X` commands — a second hand-maintained copy of that list is exactly how 9 real gates went unchecked here before the Phase 168 alignment
- ✅ Do keep changes behavioral-neutral (cleanup only, no feature changes)
- ✅ Do use `deno task` wrappers instead of raw `deno check/lint/fmt` — they automatically include `exaix-team/`
- ✅ Do verify edition-conditional placement when touching edition-aware code
- ❌ Don't use `as any` to silence type errors
- ❌ Don't skip intermediate validations and only run the full suite at the end
- ❌ Don't refactor or restructure code during a cleanup pass
- ❌ Don't commit until every check reports zero violations
- ❌ Don't suppress lint rules without a documented reason
- ❌ Don't add `EXAIX_EDITION` conditionals outside allowed paths — use edition-composer instead

Related skills
- #refactor-check-magic — Run when magic violation count is non-trivial (> 5)
- #refactor              — God object decomposition via service extraction
- #fix-bug              — For any regression introduced by a cleanup fix
- #next-steps           — When cleanup is one gated step in a phase plan
- #commit               — Create a structured commit message after cleanup
- #edition-development  — When the cleanup touches edition-separation logic (composers, seam wiring)

Workflow chain (typical):
  **#clean-codebase** → #commit
```

## Related

- [CLAUDE.md](../../../CLAUDE.md#behavioral-guidelines) — universal behavioral guidelines (think before coding, simplicity, surgical changes, goal-driven execution)
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
