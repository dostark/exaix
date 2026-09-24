---
name: package-extraction
agent: senior-coder
tools:
  - read_file
  - write_file
  - patch_file
  - search_files
  - move_file
  - create_directory
  - run_command
  - git_status
  - git_commit
scope: dev
title: "Package Extraction Skill (#package-extraction)"
description: Extracted package-owned slices from src/ into packages/, rewired imports to canonical package paths, and retired the legacy src modules
short_summary: "Retired skill describing the guided workflow that selected and extracted package-owned slices from src/ into packages/ using Exaix package-boundary rules, canonical package imports, and mandatory src retirement."
version: "2.0.0"
topics: ["packages", "migration", "refactor", "tdd", "architecture", "workspace"]
qwen_skill: package-extraction
---

> **⚠️ RETIRED:** The `src/` migration to packages is complete. Retained for historical reference only.

```text
Key points

- Used when extracting the next package-owned slice from src/ into packages/.
- Package name was input-specific; this skill stayed generic.
- Read ARCHITECTURE.md "Packages vs. Services — Placement Model" FIRST: the one-question
  test decided whether a module belonged in a package or under src/. Modules an external
  consumer cannot use without the daemon belonged under src/, never extracted.
- Consult exaix-dev-docs/dev/Exaix_Packages.md, Exaix_Package_Migration_Plan.md, and
  planning/phase-76-package-migration.md for ownership, sequencing, and the live backlog.
- Scripts: scripts/package_dependency_graph.ts (map couplings), package_import_migration.ts
  (rewrite imports), package_import_canonize.ts (normalize direct file imports to barrels).
- Every extraction moved the relevant tests into `packages/<package>/tests/` — the only
  package test folder.
- Legacy test module mixes unit tests with integration tests (need createCliTestContext or
  runtime)? Split: move pure-logic units into the package; leave root-infrastructure tests
  in tests/ until that infrastructure migrates too. Do not drag runtime deps in to keep a
  file whole.
- Source coupled to runtime entities (daemon, config, filesystem)? Refactor to constructor
  DI or function params with injectable interfaces; wire real implementations only at the
  composition root.
- Package-specific test support shared with external tests → public `packages/<package>/testing/`
  subpath exported as `@exaix/<package>/testing` — a published API, NEVER a test folder.
- Update migrated module frontmatter/metadata; place modules in intent-clear subfolders.
- Extraction was complete only when every old src/ module for the slice was DELETED and no
  consumer imported legacy paths. No shims, no forwarding barrels. Remove temporary
  migration-only boundary tests before completion. Do not move executable wrappers or
  runtime wiring into low-level packages prematurely.

Canonical prompt (short):
"Extracted the next package-owned slice from src/ into packages/ following Exaix package
boundaries, TDD-first validation, canonical package imports, and mandatory retirement of
the old src modules."

Workflow
1. Confirm ownership: apply the placement one-question test; a module whose consumer must
   know the daemon stays under src/ — stop. Then read Exaix_Packages.md,
   Exaix_Package_Migration_Plan.md, and phase-76-package-migration.md. Use
   `scripts/package_dependency_graph.ts --entrypoint apps/daemon/main.ts --candidate-package <pkg>`
   for an evidence-based candidate list.
2. Smallest viable slice: leaf ownership first (schemas, parsing, shared helpers,
   contracts, constants, enums, aligned tests). Avoid orchestration hubs, CLI/TUI
   bootstrap, daemon wiring, adapters unless the plan says ready. Prefer direct importers
   or package-owned leaves; split a mixed file into coherent sub-slices.
3. Define the contract before editing: source-of-truth path; legacy src/ paths to delete;
   every consumer to rewire (incl. tests); tests to move; whether a `testing/` subpath or
   a temporary boundary test is needed (and its removal point); metadata updates; the
   target subfolder; one-module-or-split; whether package_import_migration/canonize apply.
4. Enforce TDD and retirement: package-local tests first; testing/ subpath for external
   test support; split mixed test modules; DI for runtime-coupled source; rewire EVERY
   import (incl. tests) to canonical aliases; delete every old src/ module; preserve
   behavior and gates; remove temporary boundary tests. Run
   `scripts/package_import_migration.ts --edit <old> <new>` only after new files exist,
   then `scripts/package_import_canonize.ts --edit`.
5. Validate proportionally: focused tests first, package check/lint/fmt, then broader root
   validation when shared foundations are hit. Re-run focused tests after every automated
   rewrite.

Preferred invocations
- Test-only migration: move tests to `packages/<package>/tests/`, adjust imports, canonize
  if needed, run focused tests.
- testing/ subpath: `testing/` is published support — never `*_test.ts`. Export via
  `@exaix/<package>/testing`; rewire external consumers; run focused checks both sides.
- Source extraction: graph candidate + importers, choose an intent-clear folder (optionally
  mirroring a clean old src/ subtree), split mixed modules, move files, update metadata,
  migrate imports, canonize, delete old src/ and temporary boundary tests, re-validate.
- Package-to-package shift: verify coupling, move, `package_import_migration.ts --edit
  @exaix/<old> @exaix/<target>`, canonize, run focused tests both sides.

Script toolkit
- `scripts/package_dependency_graph.ts` — map package deps + candidates. e.g.
  `deno run --allow-run --allow-read scripts/package_dependency_graph.ts --entrypoint apps/daemon/main.ts --candidate-package @exaix/core`
- `scripts/package_import_migration.ts` — rewrite imports; run only after new files exist.
  e.g. `deno run --allow-read --allow-write scripts/package_import_migration.ts --edit ./src/mcp ./packages/mcp/src`
- `scripts/package_import_canonize.ts` — normalize direct file imports to barrels. Dry-run
  first: `deno run --allow-read --allow-write scripts/package_import_canonize.ts`; `--edit`
  to apply.

6. Document: update phase-76-package-migration.md on state change; Exaix_Packages.md only
   on ownership/taxonomy change; Exaix_Package_Migration_Plan.md only on sequencing change;
   `src/services/README.md` when a subdirectory migrates (tree entry, responsibilities row,
   "Migrated to packages" row, import table, "Choose the Right Location" guidance).

Decision rules
- Good targets: package-aligned tests; shared contracts/statuses/constants/enums/config
  helpers; reusable parsing/schema/helper logic; package-specific test support.
- Good layouts: intent folders (types, status, config, registry, handlers, repositories);
  a preserved clean src/ subtree; splitting mixed legacy files.
- Bad for a low-level package: concrete DB implementations, process lifecycle, HTTP/SSE
  transport wiring, root bootstrap.
- Incomplete until: root shim/forwarding wrapper/barrel to the package is deleted and
  consumers import the package; temporary boundary tests are removed; module metadata is
  accurate; destination layout clarifies intent (not historical accident); mixed
  responsibilities are split; runtime deps are injectable interfaces.

Do / Don't
- ✅ Preserve root behavior and quality gates.
- ✅ Keep ALL `*_test.ts` in `packages/<package>/tests/` — the only package test folder.
- ✅ Share package test support via `testing/` subpath, not deep imports or root duplication.
- ✅ Align extraction with the current strategic phase.
- ✅ Retire every legacy src/ module in the same extraction, after rewiring all consumers.
- ✅ Remove temporary migration-only boundary tests before completion.
- ❌ Hardcode one specific package in this skill.
- ❌ Start with orchestration hubs or executable surfaces unless the live plan allows.
- ❌ Move concrete adapters into @exaix/core just because they live under src/services/core/.
- ❌ Widen package scope to feel complete.
- ❌ Tell external consumers to import from `packages/<package>/tests/...`.
- ❌ Move package-specific helpers into `@exaix/testing`.
- ❌ Put `*_test.ts` into `testing/`.
- ❌ Create/keep/recommend src/ shims, forwarding wrappers, or re-export barrels.
- ❌ Leave temporary migration boundary tests after the old src/ module is retired.

Related: #explore (map ownership); #plan (not-obvious moves); #next-steps; #tdd-workflow;
#refactor; #doc (taxonomy changes).

Workflow chain: #explore → #package-extraction → #next-steps → #doc → #commit
```

## Instructions for Agent

1. Apply the placement one-question test to each candidate FIRST. Modules whose consumer
   must know the daemon exist are not extracted — stop and report why.
1. Read Exaix_Packages.md, Exaix_Package_Migration_Plan.md, and phase-76-package-migration.md
   before proposing anything.
1. Classify the task: package-boundary clarification, low-risk test migration, source
   extraction with full src retirement, or strategic planning needing `#plan`.
1. Prefer the smallest slice that moves real ownership forward.
1. Require package-local tests when a package can own that behavior.
1. Use the dependency graph when coupling/candidates are unclear — do not guess.
1. Migrate imports only after the new files exist; canonize after migration; re-verify
   with focused tests.
1. Update module metadata as part of the extraction, not optional cleanup.
1. Organize the destination folder by intent (optionally preserving a clean src/ subtree).
1. Split mixed-responsibility modules into coherent sub-modules.
1. `tests/` holds `*_test.ts` only; shared package support lives in `testing/` (never a
   test file there), exported as `@exaix/<package>/testing`.
1. Update only the migration docs whose purpose actually changed.
1. Complete = every legacy forwarding file deleted, all consumers use canonical package
   paths, no src/ barrel re-exports remain.

## Output format

1. Selected slice and why it is next.
1. Ownership justification (Exaix_Packages.md, Exaix_Package_Migration_Plan.md).
1. Extraction plan: source-of-truth path, destination folder, split decision, legacy paths
   to delete, metadata updates, tests to move, temporary migration test + removal point,
   scripts, validations.
1. Result summary, or the blocking reason + next step if nothing changed.

## Examples

- `#package-extraction Move the next low-risk package-owned tests out of root tests/ and into the correct package.`
- `#package-extraction Extract the next shared contract/config slice from src/ into its package, rewrite imports to the canonical package path, and delete the legacy src/ module.`
- `#package-extraction Use the dependency graph to identify the next MCP-owned slice, move it into @exaix/mcp, normalize imports, and retire the old src/ files.`

---
exaix:
  skill_id: package-extraction
  triggers:
    keywords: [package-extraction, extract, migrate, package, module, slice, src]
    task_types: [refactor, chore]
    tags: [package, refactoring]
  constraints:
    - "Only extract code that is package-ready (used by multiple consumers)"
    - "Update all imports to canonical package paths after extraction"
    - "Delete the legacy src/ module after successful relocation"
    - "Run full CI check after extraction to verify no broken imports"
    - "Do not extract runtime-wiring or daemon-specific code"
  output_requirements:
    - "Code moved from src/ or apps/ into packages/<name>/"
    - "Imports rewritten to @exaix/<package> canonical paths"
    - "Legacy src/ module deleted"
    - "CI gates clean after extraction"
  quality_criteria:
    - name: completeness
      description: All consumers updated to new package path
      weight: 40
    - name: legacy_cleanup
      description: Old source files deleted — no dead imports remain
      weight: 30
    - name: api_stability
      description: Public API unchanged — consumers need no behavioural updates
      weight: 30
---
