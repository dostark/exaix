---
name: upgrade-version
agent: general
tools:
  - read_file
  - patch_file
  - write_file
  - search_files
  - run_command
scope: dev
title: "Upgrade-Version Skill (#upgrade-version)"
description: Safely upgrade a dependency or runtime version — semver audit, compatibility check, regression validation, breaking-change docs
short_summary: "Multi-step skill for planning and executing dependency or runtime upgrades with full regression coverage."
version: "1.0.0"
topics: ["upgrade", "dependencies", "version", "maintenance", "regression"]
qwen_skill: upgrade-version
---

```text
Key points

- Do not upgrade blindly — read the changelog and identify breaking changes first.
- Write or update regression tests BEFORE applying the upgrade.
- Keep the upgrade atomic: one dependency per commit where possible.
- Have a verified rollback path before merging.
- Run the full test suite (deno task test) after any version bump — blast radius unknown.
- Call-site audits > ~20 files: batches of 5–10. Read a batch, record findings, continue.

Canonical prompt (short):
"Upgrade [dependency/runtime] from [current version] to [target version].
Audit breaking changes, write regression tests, apply upgrade, run full CI,
document any required migration steps."

Workflow
────────
Phase 1 — Audit
  1. Identify target: package name, current version, target version.
  2. Fetch the changelog (CHANGELOG.md or GitHub releases) for every version between.
  3. Classify changes:
     - BREAKING: API removals, renamed symbols, changed behavior
     - DEPRECATION: still works, marked for removal
     - COMPATIBLE: new features, bug fixes (low risk)
  4. BREAKING: list every affected call site in packages/, apps/, tests/.

Phase 2 — Regression net
  5. Per breaking call site, write (or verify) tests asserting current behavior. Run them —
     they must pass on the current version (GREEN baseline).
  6. Coverage for affected modules < 70% line / 60% branch? Add targeted tests first (see #coverage).

Phase 3 — Apply
  7. Update the version in deno.json (or import map / package.json as applicable).
  8. Run `deno cache --reload <affected-imports>`.
  9. Fix compile errors with `deno check packages/ apps/ tests/`. Follow the migration
     guide; prefer minimal call-site changes.
 10. Fix renamed/removed symbols — never `as any` workarounds.

Phase 4 — Validate
 11. deno lint
 12. deno fmt --check
 13. deno task check:style
 14. deno task check:arch
 15. deno task check:magic   (if new literals introduced)
 16. deno task test          (full suite — blast radius unknown after the bump)
 17. deno run -A scripts/ci.ts coverage  (thresholds still met)

Phase 5 — Document
 18. Public behavior changed? Update the relevant doc in docs/.
 19. Non-trivial migration steps? Add a note to CONTRIBUTING.md or the README.
 20. Part of a phase step? Record the upgrade in the planning doc.

Commit
 21. Use #commit. Subject example: `chore(deps): upgrade <package> from <old> to <new>`.
     Fields: what:, rationale:, tests:, who:, impact:.
     CI gates: lint OK, type-check OK, style 0 errors, arch N GROUNDED, full suite OK.

Phase 6 — Rollback (if blocked)
 22. Revert deno.json, re-run `deno cache --reload`, confirm the GREEN baseline.
 23. Document the blocker in the planning doc with a concrete next action.

Do / Don't
- ✅ Read the changelog before touching code.
- ✅ Write regression tests on the current version BEFORE upgrading.
- ✅ Fix breaking changes by adapting call sites, not `as any`.
- ✅ Run the full test suite after a version bump.
- ✅ Document breaking migration steps.
- ✅ Prefer one dependency per commit.
- ❌ Upgrade without a verified rollback path.
- ❌ Use `as any` to suppress type errors from the bump.
- ❌ Skip the full test suite — partial runs miss cross-module regressions.
- ❌ Merge with failing tests or unchecked coverage drops.

Related: #coverage; #fix-bug; #next-steps; #commit.

Workflow chain: #review-phase-plan (if part of a phase) → **#upgrade-version** → #commit
```

## Related

- [CODE_STYLE.md](../../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules

## Output format

1. Audit summary: package, old → new, N breaking changes.
1. Affected call sites.
1. Regression net: test files written/updated, GREEN baseline confirmed.
1. Compile/lint results after the upgrade.
1. Full test suite results: N/N passing.
1. Coverage delta (before vs. after).
1. Migration doc changes (if any).
1. Commit payload.

## Examples

- `#upgrade-version Deno runtime from 1.44 to 2.x`
- `#upgrade-version @std/path to latest — check for breaking API changes`
- `#upgrade-version openai SDK — write regression tests on current version first`

---
exaix:
  skill_id: upgrade
  triggers:
    keywords: [upgrade, update, dependency, version, semver, bump]
    task_types: [chore]
    tags: [upgrade, dependencies]
  constraints:
    - "Read the changelog before touching any code"
    - "Write regression tests on current version BEFORE upgrading"
    - "Fix breaking changes by adapting call sites, not with as any"
    - "Run the full test suite after a version bump"
    - "Prefer one dependency per commit for clean rollback"
    - "Do not upgrade without a verified rollback path"
  output_requirements:
    - "Audit summary: package, old to new version, breaking changes identified"
    - "Affected call sites list"
    - "Regression net: test files written or updated, GREEN baseline confirmed"
    - "Compile/lint results after upgrade applied"
    - "Full test suite results: N/N passing"
    - "Coverage delta (before vs. after)"
  quality_criteria:
    - name: regression_safety
      description: Regression tests written on current version before upgrade
      weight: 40
    - name: breaking_change_coverage
      description: All breaking-change call sites adapted, not suppressed
      weight: 30
    - name: rollback_readiness
      description: Rollback path verified before committing
      weight: 30
---
