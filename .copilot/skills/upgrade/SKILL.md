---
name: upgrade
agent: general
tools:
  - read_file
  - patch_file
  - write_file
  - search_files
  - run_command
scope: dev
title: "Upgrade Skill (#upgrade)"
description: Safely upgrade a dependency or runtime version — semver audit, compatibility check, regression validation, breaking-change docs
short_summary: "Multi-step skill for planning and executing dependency or runtime upgrades with full regression coverage."
version: "1.0"
topics: ["upgrade", "dependencies", "version", "maintenance", "regression"]
qwen_skill: upgrade
---

```text
Key points
- Never upgrade blindly — read the changelog and identify breaking changes first
- Write or update regression tests BEFORE applying the upgrade
- Keep the upgrade atomic: one dependency per commit where possible
- Always have a verified rollback path before merging
- Run the full test suite (deno task test) after any version bump — blast radius is unknown
- When auditing call sites across more than ~20 files, work in batches of 5–10: read a batch, record findings, then continue

Canonical prompt (short):
"Upgrade [dependency/runtime] from [current version] to [target version].
Audit breaking changes, write regression tests, apply upgrade, run full CI,
document any required migration steps."

Workflow
────────
Phase 1 — Audit
  1. Identify the upgrade target: package name, current version, target version.
  2. Fetch the changelog (CHANGELOG.md or GitHub releases) for all versions between
     current and target.
  3. Classify changes:
     - BREAKING: API removals, renamed symbols, changed behavior
     - DEPRECATION: still works but marked for removal
     - COMPATIBLE: new features, bug fixes (low risk)
  4. For BREAKING changes: identify every call site in packages/, apps/, and tests/ that is affected.

Phase 2 — Regression net
  5. For each breaking call site, write (or verify existing) tests that assert the
     current behavior. Run them — they must pass on the current version (GREEN baseline).
  6. If coverage for affected modules is < 70% line / 60% branch, add targeted tests
     before proceeding (see #coverage).

Phase 3 — Apply upgrade
  7. Update the version in deno.json (or import map / package.json as applicable).
  8. Run `deno cache --reload <affected-imports>` to pull the new version.
  9. Fix all compile errors:
       deno check packages/ apps/ tests/
     Resolve BREAKING changes following migration guide; prefer minimal call-site changes.
 10. Fix any renamed/removed symbols — do NOT use `as any` workarounds.

Phase 4 — Full validation
 11. deno lint
 12. deno fmt --check
 13. deno task check:style
 14. deno task check:arch
 15. deno task check:magic   (if new string/numeric literals were introduced)
 16. deno task test          (full suite — blast radius unknown after version bump)
 17. deno run -A scripts/ci.ts coverage  (confirm thresholds still met)

Phase 5 — Document
 18. If any public-facing behavior changed: update the relevant doc in docs/.
 19. If migration steps are non-trivial: add a migration note to CONTRIBUTING.md or
     the relevant README.
 20. Record the upgrade in the planning doc if it was part of a phase step.

Commit
 21. Use #commit for the structured commit body. Subject example:
       chore(deps): upgrade <package> from <old> to <new>

       what: updated <package> to <version>; resolved N breaking-change call sites
       rationale: <security fix / feature requirement / maintenance>
       tests: <affected test files>, all passing
       who: <agent identity>
       impact: <affected modules>

       CI gates: lint OK, type-check OK, style 0 errors, arch N GROUNDED, full suite OK

Phase 6 — Rollback (if blocked)
 22. Revert deno.json change, re-run `deno cache --reload`, confirm GREEN baseline.
 23. Document the blocker in the planning doc with a concrete next-action.

Do / Don't
- ✅ Do read the changelog before touching any code
- ✅ Do write regression tests on current version BEFORE upgrading
- ✅ Do fix breaking changes by adapting call sites, not with `as any`
- ✅ Do run the full test suite after a version bump
- ✅ Do document breaking migration steps
- ✅ Do prefer one dependency per commit
- ❌ Don't upgrade without a verified rollback path
- ❌ Don't use `as any` to suppress type errors from a version bump
- ❌ Don't skip the full test suite — partial runs miss cross-module regressions
- ❌ Don't merge with failing tests or unchecked coverage drops

Related skills
- #coverage          — Boost test coverage on affected modules before upgrading
- #fix-bug           — Fix regressions discovered during upgrade validation
- #next-steps        — When the upgrade is one step in a larger phase plan
- #commit            — Create a structured commit message after the upgrade

Workflow chain (typical):
  #pre-gap-analysis (if upgrade is part of a phase) → **#upgrade** → #commit
```

## Related

- [CODE_STYLE.md](../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules

## Output format

1. Audit summary: package, old → new version, N breaking changes identified.
1. Affected call sites list.
1. Regression net: test files written/updated, GREEN baseline confirmed.
1. Compile/lint results after upgrade applied.
1. Full test suite results: N/N passing.
1. Coverage delta (before vs. after).
1. Migration doc changes (if any).
1. Commit payload.

## Examples

- `#upgrade Deno runtime from 1.44 to 2.x`
- `#upgrade @std/path to latest — check for breaking API changes`
- `#upgrade openai SDK — write regression tests on current version first`
