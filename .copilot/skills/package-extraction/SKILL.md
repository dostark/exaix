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
description: Extract the next package-owned slice from src/ into packages/, rewire imports to canonical package paths, and retire the legacy src modules
short_summary: "Guided workflow for selecting and extracting the next package-owned slice from src/ into packages/ using Exaix package-boundary rules, canonical package imports, and mandatory src retirement."
version: "2.0"
topics: ["packages", "migration", "refactor", "tdd", "architecture", "workspace"]
qwen_skill: package-extraction
---

```text
Key points
- Use this skill when the goal is to extract the next package-owned slice from src/ into packages/
- The package name is input-specific; this skill must remain generic and must not assume one fixed package
- Read ARCHITECTURE.md "Packages vs. Services — Placement Model" FIRST to determine whether a candidate module belongs in a package or must stay in src/services/; the placement model defines the one-question test, dependency signals, and concrete examples that settle ambiguous cases before any files are moved
- Consult exaix-dev-docs/dev/Exaix_Packages.md for current ownership and target package boundaries
- Consult exaix-dev-docs/dev/Exaix_Package_Migration_Plan.md for strategic sequencing and ambiguous-module rules
- Consult exaix-dev-docs/planning/phase-76-package-migration.md for the live backlog and current branch state
- Use scripts/package_dependency_graph.ts to map package-level dependencies and identify src/ modules that are candidates for a target package
- Use scripts/package_import_migration.ts to rewrite imports from old ownership paths to the new package-owned source of truth
- Use scripts/package_import_canonize.ts after extraction to normalize direct package file imports to canonical package or subfolder barrel imports
- Every extraction must include the relevant test migration into packages/<package>/tests/ — this is the only folder where test files (*_test.ts) live in a package
- When a legacy test module mixes unit-level tests (pure logic) with integration-level tests (require runtime setup like createCliTestContext), split it into separate test files during extraction. Move only the unit-level tests into the package; leave test cases that depend on root infrastructure in tests/ until that infrastructure is also migrated. Do not copy runtime dependencies into the package just to keep a test module whole.
- When source code under extraction couples to runtime entities (daemon, services, config, filesystem), refactor it to accept those dependencies via constructor DI or function parameters so the extracted module exposes testable interfaces. Replace concrete runtime types with injectable interfaces in the package; wire real implementations only at the composition root or in the consumer adapter layer.
- When package-specific test helpers, configs, or test-only data structures must be used both by
   tests inside the package and tests outside it, create a public package-owned testing subpath
   (`packages/<package>/testing/`) exported as `@exaix/<package>/testing` — this is a published
   support API surface, NOT a test folder; it must never contain test files (`*_test.ts`)
- Update the migrated module frontmatter or file-level metadata so ownership, path, module purpose, and package intent remain accurate after the move
- Preserve a clear architectural layout inside the target package by placing migrated modules into correspondent subfolders that communicate intent and functionality
- When practical, keep the old `src/` folder tree shape as the starting layout inside `packages/<package>/src/`, but only if that tree still reflects a clean package-internal architecture
- When a legacy module mixes multiple responsibilities because the old root implementation was not cleanly separated, consider splitting it into smaller sub-modules during extraction instead of copying the mixed design into the package
- After package-owned source-of-truth files exist, migrate every reachable call site — including all test files — to canonical package imports and retire all legacy src/ modules in the same extraction. Extraction is not complete until every old src/ module for the moved slice is deleted and zero consumers import from legacy paths.
- Do not create or preserve src/ shim layers that simply route to package modules; they hide incomplete migration and mask clean package boundaries
- If a temporary boundary or migration-regression test is introduced only to protect a transition, remove it before the extraction is considered complete once the legacy src/ module is deleted and callers are rewired
- Do not move executable wrappers or runtime wiring into low-level packages prematurely

Canonical prompt (short):
"Extract the next package-owned slice from src/ into packages/ following Exaix package boundaries, TDD-first validation, canonical package imports, and mandatory retirement of the old src modules."

Workflow
1. Confirm the target ownership slice
   - Read ARCHITECTURE.md §"Packages vs. Services — Placement Model" to apply the canonical placement test: if an external consumer cannot use the module without knowing the Exaix daemon exists, it belongs in src/services/, not in a package — stop here and do not extract it
   - Read Exaix_Packages.md to verify that the requested source files belong in a package and are not runtime-only or transport-only concerns
   - Read Exaix_Package_Migration_Plan.md to verify that the extraction fits the current strategic phase
   - Read phase-76-package-migration.md to confirm the extraction is not contradictory to the live backlog
   - Run `deno run --allow-run --allow-read scripts/package_dependency_graph.ts --entrypoint src/main.ts --candidate-package <package>` when you need an evidence-based list of src/ modules currently coupled to the target package

2. Choose the smallest viable extraction slice
   - Prefer leaf ownership first: schemas, parsing, shared test helpers, low-level shared contracts, constants, enums, or already package-aligned tests
   - Avoid orchestration hubs, CLI/TUI bootstrap, daemon wiring, health endpoints, signal handling, and concrete adapters unless the plan explicitly says they are ready
   - If the package already exists, move a narrow package-owned slice before expanding package scope
   - Use the dependency-graph output to distinguish direct src/ importers from transitive dependents; prefer starting with direct importers or obviously package-owned leaves
   - If the candidate file mixes unrelated concerns, choose the smallest coherent sub-slice and plan a split into separate sub-modules rather than migrating the whole mixed file unchanged

3. Define the migration contract before editing
   - Identify the source of truth path under packages/
   - Identify every legacy src/ path that must be deleted before the extraction is done
   - Identify every consumer of each legacy path (including test files) that must be rewired before deletion
   - Identify which tests move into packages/<package>/tests/
   - Identify whether the slice also needs a public package-owned testing surface such as
     `packages/<package>/testing/` for helpers, configs, or fixtures that external tests must import
   - Identify whether a temporary migration boundary test is needed and how it will be removed before completion
   - Identify root validations needed after the move
   - Identify how the migrated module frontmatter or file header must change so module metadata remains correct in its new package location
   - Identify the target package subfolder that best communicates the module's intent; prefer a deliberate architectural folder over a flat dump into `src/`
   - Decide whether the moved code should stay as one module or be split into multiple sub-modules so each file has one clear responsibility inside the package
   - Decide whether `scripts/package_import_migration.ts` can rewrite affected imports safely once the new source-of-truth files exist
   - Decide whether `scripts/package_import_canonize.ts --edit` should be used after the move to collapse direct file imports to canonical package aliases or subfolder barrels

4. Enforce TDD and retirement
   - Migrate or add package-local tests first when the extraction changes ownership in a testable slice
   - If tests outside the package need package-specific support code, create a narrow exported
     testing surface for that package instead of telling external tests to import from
     `packages/<package>/tests/`
   - When a legacy test module bundles test cases at multiple abstraction levels (pure-logic unit tests alongside tests that need createCliTestContext, filesystem fixtures, or daemon stubs), split the test cases into separate test files:
     * Extract pure-logic, no-side-effect test cases into the package as unit tests
     * Leave test cases requiring root infrastructure (runtime setup, helpers that import from src/services/, filesystem wiring, database setup) in tests/ until that infrastructure is migrated too
     * Do not drag runtime dependencies into the package just to keep a test file whole — that leaks the very coupling the extraction is meant to sever
   - When the source code under extraction depends on runtime entities (daemon services, global config, filesystem paths, database, or other concrete infrastructure), refactor it during extraction to accept those dependencies via constructor DI or function parameters. Use injectable interfaces in the package; wire concrete implementations only at the composition root. This keeps the extracted module unit-testable without importing runtime infrastructure.
   - Move the module into a package-local folder that preserves clear architectural intent, for example `types/`, `status/`, `config/`, `handlers/`, `registry/`, or another functionally coherent subfolder
   - Preserve or improve the old `src/` tree shape when it already provides a clear intent-based structure; do not copy confusing root runtime structure into a package mechanically
   - If the legacy module mixes concerns, split it into smaller files with clear intent during extraction instead of copying mixed design into the package
   - Update the migrated module frontmatter or file-level metadata immediately after the move so `@module`, `@path`, ownership notes, and other location-sensitive metadata do not drift
   - Rewire every reachable import — including all test files — to canonical package aliases or approved package subpath barrels as part of the extraction; do not leave any dependency on legacy src/ paths behind
   - Delete every old src/ module for the moved slice once imports are rewired; do not leave re-export shims, forwarding wrappers, thin barrels, or any compatibility file in src/
   - Preserve public behavior and quality gates while changing import ownership
   - Use `scripts/package_import_migration.ts --edit <old-path-or-package> <new-path-or-package>` only after the new package-owned files exist
   - Treat import rewrite scripts as accelerators, not as substitutes for validating ownership boundaries and fully retiring the old src/ surface
   - Remove any temporary migration boundary test before completion if its only purpose was to guard deletion of the old src/ module

5. Validate proportionally
   - First run focused tests for the moved slice
   - Then run package-local check/lint/fmt where practical
   - Run broader root validation when the blast radius reaches shared runtime foundations or when the user requests it
   - If imports were rewritten into direct package file paths, run `deno run --allow-read --allow-write scripts/package_import_canonize.ts --edit` to normalize them before final validation
   - Re-run the focused tests after each automated rewrite step so script-driven changes do not hide behavior regressions

Preferred invocation order
- Test-only migration into an existing package
   - Use when moving tests from `tests/` into `packages/<package>/tests/` without changing source ownership
   - 1. Inspect package coupling only if needed:
      `deno run --allow-run --allow-read scripts/package_dependency_graph.ts --entrypoint src/main.ts --candidate-package @exaix/<package>`
   - 2. Move the test files manually and adjust imports locally
   - 3. If test imports now point at direct package file paths, normalize them:
      `deno run --allow-read --allow-write scripts/package_import_canonize.ts --edit`
   - 4. Run focused tests for the moved package tests
- Package-owned testing subpath extraction
   - Use when helpers, config builders, or test-only data structures belong to one package but must
     be imported by tests outside that package
   - `testing/` is a published support API surface — it must NEVER contain test files (`*_test.ts`);
     test files belong exclusively in `tests/`
   - 1. Keep package-local tests under `packages/<package>/tests/`
   - 2. Create `packages/<package>/testing/` as the public test-support surface (no test files here)
   - 3. Export that surface via package config and import-map aliases such as `@exaix/<package>/testing`
   - 4. Migrate outside consumers to the new testing alias instead of deep imports or root helper duplication
   - 5. Rewire outside consumers to the new testing alias immediately; do not leave src/ forwarding modules behind
   - 6. Run focused tests and checks for both the package tests and the external consumers that were rewired
- Source extraction from `src/` into an existing package
   - Use when the package already exists and the slice has a clear destination under `packages/<package>/src/`
   - 1. Identify candidate src modules and direct importers:
      `deno run --allow-run --allow-read scripts/package_dependency_graph.ts --entrypoint src/main.ts --candidate-package @exaix/<package>`
      Example for MCP ownership work:
      `deno run --allow-run --allow-read scripts/package_dependency_graph.ts --entrypoint src/main.ts --candidate-package @exaix/mcp`
   - 2. Choose a package-internal destination folder that expresses intent, optionally mirroring the old `src/` subtree when that shape is still architecturally clean
   - 3. If the old module mixes concerns, split it into coherent sub-modules before or during the move so the package layout improves rather than inherits the ambiguity
   - 4. Move the source-of-truth files into `packages/<package>/src/...`
   - 5. Update migrated module frontmatter or file headers to reflect the new path, ownership, and module responsibility
   - 6. Rewrite every import — including all test files — from old paths to the new package-owned source of truth:
      `deno run --allow-read --allow-write scripts/package_import_migration.ts --edit <old-path-or-package> <new-path-or-package>`
   - 7. Canonicalize package imports after the broad rewrite:
      `deno run --allow-read --allow-write scripts/package_import_canonize.ts --edit`
   - 8. Delete the old src/ module and any temporary boundary test created for the transition
   - 9. Re-run focused tests, then broader validation as needed
- Package-to-package ownership shift
   - Use when code already lives under `packages/` but belongs in a different package
   - 1. Verify package coupling if the blast radius is unclear:
      `deno run --allow-run --allow-read scripts/package_dependency_graph.ts --entrypoint src/main.ts --candidate-package @exaix/<target-package>`
   - 2. Move the files into the target package
   - 3. Rewrite imports using package or package-path arguments:
      `deno run --allow-read --allow-write scripts/package_import_migration.ts --edit @exaix/<old-package> @exaix/<target-package>`
   - 4. Canonicalize direct file imports:
      `deno run --allow-read --allow-write scripts/package_import_canonize.ts --edit`
   - 5. Run focused tests for both the source and target package slices

Preferred arguments
- For `scripts/package_dependency_graph.ts`
   - Prefer canonical package aliases for `--candidate-package`, for example `@exaix/core`, `@exaix/testing`, `@exaix/git`
   - Prefer `--entrypoint src/main.ts` unless you are intentionally analyzing a narrower runtime path
- For `scripts/package_import_migration.ts`
   - Prefer path arguments when migrating from `src/` into `packages/`, for example:
      `deno run --allow-read --allow-write scripts/package_import_migration.ts --edit ./src/shared/interfaces ./packages/core/src/types`
   - MCP example for moving a transport-owned slice out of `src/` once the destination files exist:
      `deno run --allow-read --allow-write scripts/package_import_migration.ts --edit ./src/mcp ./packages/mcp/src`
   - Prefer package alias arguments when shifting ownership between existing packages, for example:
      `deno run --allow-read --allow-write scripts/package_import_migration.ts --edit @exaix/core @exaix/tui`
   - Do not run this script before the destination files exist; it is a rewrite step, not a planner
- For `scripts/package_import_canonize.ts`
   - Prefer dry-run first when the import churn may be large:
      `deno run --allow-read --allow-write scripts/package_import_canonize.ts`
   - Use `--edit` only after reviewing whether new or existing barrels represent the intended public import surface

Script toolkit
- `scripts/package_dependency_graph.ts`
  - Purpose: map package-level dependencies and list candidate src/ modules for a target package
  - Typical usage: `deno run --allow-run --allow-read scripts/package_dependency_graph.ts --entrypoint src/main.ts --candidate-package @exaix/core`
- `scripts/package_import_migration.ts`
  - Purpose: rewrite imports from old ownership paths or packages to new package-owned locations
  - Typical usage: `deno run --allow-read --allow-write scripts/package_import_migration.ts --edit ./src/shared/interfaces ./packages/core/src/types`
- `scripts/package_import_canonize.ts`
  - Purpose: convert direct package file imports inside packages/ to canonical package or subfolder barrel imports
  - Typical usage: `deno run --allow-read --allow-write scripts/package_import_canonize.ts --edit`

6. Update migration documentation
   - Update phase-76-package-migration.md when package state, completed milestones, or next steps change
   - Update Exaix_Packages.md only when ownership definitions or package taxonomy change
   - Update Exaix_Package_Migration_Plan.md only when strategic sequencing or target mapping changes
   - Update src/services/README.md whenever a directory under src/services/ is migrated or deleted:
     - Remove the directory entry from the "Directory Structure" tree
     - Remove its row from the appropriate "Folder Responsibilities" table
     - Add a row to the "Migrated to packages" table (old path → package → import alias)
     - Update the "Common Import Migrations" table with the new canonical import path
     - Update any "Choose the Right Location" guidance that mentioned the removed directory

Decision rules
- Good extraction targets:
  - package-aligned tests already importing package APIs
  - shared contracts, statuses, constants, enums, config helpers
  - reusable parsing/schema/helper logic
   - package-specific test helpers/configs/fixtures that are needed by tests both inside and outside
      the owning package
- Good package-internal layout choices:
   - folders whose names expose intent and responsibility, such as `types`, `status`, `config`, `registry`, `handlers`, `repositories`, or similarly clear domain groupings
   - preserving an old `src/` subtree when it already reflects a coherent architectural slice rather than root-runtime accident
   - splitting a mixed legacy file into separate package sub-modules when that is the cleanest way to restore architectural clarity
- Bad extraction targets for a low-level package:
  - concrete SQLite/database implementations
  - process lifecycle and signal handling
  - HTTP/SSE server transport wiring
  - root executable/bootstrap code
- If a root file is already a thin wrapper over a package, treat that as a blocking incompletion — the extraction is not done until the shim is deleted and all consumers import from the package directly
- If tests outside a package need package-specific support code, prefer a public package testing
   subpath over deep imports into `packages/<package>/tests/` or new root helper duplication
- If a migrated module still exists under src/ only as a forwarding wrapper, re-export, or thin barrel to the package, the extraction is incomplete
- If a temporary boundary test was added only to protect the migration or verify src/ deletion, the extraction is incomplete until that test is removed after callers are rewired and the legacy file is deleted
- If a moved file keeps stale `@path`, `@module`, ownership comments, or other frontmatter/header metadata, the extraction is incomplete even if imports compile
- If a proposed package folder structure only copies historical root layout without clarifying package intent, refactor the destination layout before considering the extraction done
- If a migrated file still mixes unrelated responsibilities that should now live in separate package sub-modules, the extraction is incomplete even if the file compiles in its new location
- If a migrated test module still depends on root runtime infrastructure (createCliTestContext, filesystem daemon stubs, src/services/ helpers) that was not extracted with it, the extraction is incomplete — either split the test module to isolate pure-unit tests inside the package, or migrate the supporting infrastructure via a `testing/` subpath before considering the extraction done
- If source code was extracted without refactoring concrete runtime dependencies into injectable interfaces, the extraction is incomplete — package code must not hardcode daemon-coupled constructors or global service accessors that prevent consumers from testing the module without the full Exaix runtime

Do / Don't
- ✅ Do update src/services/README.md whenever a src/services/ directory is migrated or deleted: remove the tree entry, remove the folder-responsibilities row, and add a row to the "Migrated to packages" table
- ✅ Do preserve root behavior and quality gates during the extraction
- ✅ Do put ALL test files (`*_test.ts`) exclusively in `packages/<package>/tests/` — this is the only valid test folder in a package
- ✅ Do create a package-owned testing subpath (`packages/<package>/testing/`) when package-specific test support must be shared with tests outside the package — this is a published support API, not a test folder
- ✅ Do align the extraction with the current strategic phase rather than the original idealized sequence
- ✅ Do treat current workspace package names as authoritative for current-state work
- ✅ Do retire every legacy src/ module in the same extraction. Rewire all consumers including tests before deletion. No shims, no forwarding wrappers, no src/ barrel re-exports to packages.
- ✅ Do remove temporary migration-only boundary tests before considering the extraction complete
- ❌ Don't mention or hardcode one specific package in this skill
- ❌ Don't start with orchestration hubs or executable surfaces unless the live plan says they are ready
- ❌ Don't move concrete adapters into @exaix/core just because they currently live under src/services/core/
- ❌ Don't widen package scope only to make a migration feel more complete
- ❌ Don't tell outside consumers to import from `packages/<package>/tests/...`
- ❌ Don't move package-specific test helpers into `@exaix/testing` when the support is clearly owned by one package
- ❌ Don't put test files (`*_test.ts`) into `testing/` — `testing/` is a published API surface, never a place for test files
- ❌ Don't create, keep, or recommend src/ shim layers, forwarding wrappers, or re-export barrels that point at package modules
- ❌ Don't leave temporary migration boundary tests in the tree after the old src/ module has been retired

Related skills
- #explore            — map candidate ownership and dependencies before extraction
- #plan               — create or refine a package-extraction plan when the next move is not obvious
- #next-steps         — execute the plan step-by-step once the extraction is planned
- #tdd-workflow       — RED → GREEN → REFACTOR validation for extracted slices
- #refactor           — behavior-preserving cleanup after a successful extraction
- #doc                — refine documentation when ownership language or package taxonomy changes materially

Workflow chain (typical)
  #explore → #package-extraction → #next-steps → #doc → #commit
```

## Instructions for Agent

When invoked, the agent should:

1. Read `ARCHITECTURE.md` §"Packages vs. Services — Placement Model" first. Apply the one-question placement test to each candidate module before reading any other document. Modules that fail the test (external consumer cannot use them without knowing the Exaix daemon) must not be extracted — stop and report the reason instead of proceeding.
2. Read `exaix-dev-docs/dev/Exaix_Packages.md`, `exaix-dev-docs/dev/Exaix_Package_Migration_Plan.md`, and `exaix-dev-docs/planning/phase-76-package-migration.md` before proposing or implementing an extraction.
3. Determine whether the requested slice is:
   - a package-boundary clarification task,
   - a low-risk test migration,
   - a source extraction with full src retirement, or
   - a strategic planning problem that needs `#plan` first.
4. Prefer the smallest slice that moves real ownership forward without destabilizing the root app.
5. Require package-local tests for the moved slice whenever a package can own tests for that behavior.
6. Use `scripts/package_dependency_graph.ts` when package coupling or candidate selection is unclear; do not guess when the graph can answer it quickly.
7. Use `scripts/package_import_migration.ts` for broad import rewrites after the new package-owned files exist, then verify the result with focused tests.
8. Use `scripts/package_import_canonize.ts` after migration rewrites to normalize package imports to canonical aliases or subfolder barrels.
9. Update migrated module frontmatter or file-level metadata as part of the extraction, not as optional cleanup.
10. Keep the target package layout intentionally organized into correspondent folders that communicate responsibility; optionally follow the old `src/` tree where that structure is still clean and meaningful.
11. Split legacy mixed-responsibility modules into coherent sub-modules when that is needed to achieve a clean package architecture instead of preserving old accidental structure.
12. A package has exactly two test-related directories with distinct roles: `tests/` for test files (`*_test.ts`) only, and optionally `testing/` as a published support API surface (never containing test files). When package-specific helpers/fixtures must be shared outside the package, put them in `packages/<package>/testing/` and export as `@exaix/<package>/testing` — never put `*_test.ts` files into `testing/`.
13. Update only the migration docs whose purpose actually changed.
14. Before calling the extraction complete, verify that every legacy src/ forwarding file for the migrated slice is deleted, every consumer including tests uses canonical package paths, and no src/ barrel re-exports to packages exist for the moved slice.

## Output format

1. Selected package-owned slice and why it is the next viable candidate.
2. Ownership justification using Exaix_Packages.md and Exaix_Package_Migration_Plan.md.
3. Extraction plan: source of truth path, package-internal destination folder, whether the module must be split into sub-modules, legacy src/ paths to delete, frontmatter/header updates, tests to move, any temporary migration test and its removal point, scripts to run, validations to run.
4. Result summary after execution or, if no code was changed, the blocking reason and the recommended next step.

## Examples

- `#package-extraction Move the next low-risk package-owned tests out of root tests/ and into the correct package.`
- `#package-extraction Extract the next shared contract/config slice from src/ into its package, rewrite imports to the canonical package path, and delete the legacy src/ module.`
- `#package-extraction Evaluate a src/ module cluster and migrate only the portion that is actually package-ready.`
- `#package-extraction Use the dependency graph to identify the next MCP-owned slice, move it into @exaix/mcp, normalize imports to canonical package paths, and retire the old src/ files.`
- `#package-extraction Create a package-owned testing subpath for helpers and fixtures that need to be shared outside the package without deep-importing package tests.`
