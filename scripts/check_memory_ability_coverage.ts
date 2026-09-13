#!/usr/bin/env -S deno run -A

/**
 * @module CheckMemoryAbilityCoverage
 * @path scripts/check_memory_ability_coverage.ts
 *
 * Usage:
 *   deno run -A scripts/check_memory_ability_coverage.ts [fixtures-dir]
 *   [fixtures-dir]  Path to the memory-task fixtures directory
 *                    (default: ./tests/scenario_framework/fixtures/memory).
 *
 * @description Phase 148 Step 6's live-catalog wiring for `assertMemoryAbilityCoverage`:
 *   reads the real `fixtures/memory/<task-id>/task.json` corpus and fails if any of the
 *   five `MemoryAbilitySchema` values has zero fixture coverage. An operator-run gate,
 *   matching `check_artefact_decision_coverage.ts`'s pattern for the same shape of
 *   check (enumerate a catalog, assert every entry is covered): a new fixture directory
 *   should not silently fail a build before its `ability` field is even readable, so
 *   this is not wired into CI — it makes "does every ability have a fixture" a
 *   checkable fact rather than a claim.
 * @architectural-layer Script
 * @dependencies [tests/scenario_framework/runner/memory_ability_coverage.ts]
 * @related-files [tests/scenario_framework/runner/memory_ability_coverage.ts, tests/scenario_framework/schema/memory_task_schema.ts, scripts/check_artefact_decision_coverage.ts]
 */

import { assertMemoryAbilityCoverage } from "../tests/scenario_framework/runner/memory_ability_coverage.ts";

const DEFAULT_FIXTURES_DIR = "./tests/scenario_framework/fixtures/memory";

if (import.meta.main) {
  const fixturesDir = Deno.args[0] ?? DEFAULT_FIXTURES_DIR;
  const { missing } = await assertMemoryAbilityCoverage([fixturesDir]);
  if (missing.length > 0) {
    console.error(`❌ Memory ability coverage: missing fixture(s) for: ${missing.join(", ")}`);
    Deno.exit(1);
  }
  console.log("✅ Memory ability coverage: all five MemoryAbilitySchema values have at least one fixture.");
}
