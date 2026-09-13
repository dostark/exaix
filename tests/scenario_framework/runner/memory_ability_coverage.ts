/**
 * @module MemoryAbilityCoverage
 * @path tests/scenario_framework/runner/memory_ability_coverage.ts
 * @description Phase 148 Step 6's ability-coverage gate: enumerates the five
 * `MemoryAbilitySchema` values and confirms at least one `fixtures/memory/<task-id>/task.json`
 * declares each. Modeled on Phase 158's artefact-decision-coverage shape
 * (`artefact_catalog.ts`/`artefact_decision_coverage.ts`: enumerate a catalog, assert
 * coverage) — NOT a reuse of Phase 142's "parity" (a ci-tier equivalence check,
 * unrelated to taxonomy completeness; see this phase's pre-gap analysis GAP-3).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/memory_ability_coverage_test.ts, tests/scenario_framework/schema/memory_task_schema.ts, tests/scenario_framework/runner/memory_corpus_lint.ts]
 */

import { join } from "@std/path";
import { MemoryAbilitySchema, MemoryTaskJsonSchema } from "../schema/memory_task_schema.ts";

export interface IMemoryAbilityCoverageResult {
  missing: string[];
}

function readTaskDirs(root: string): string[] {
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(root)];
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory).map((entry) => join(root, entry.name));
}

/** Returns the `MemoryAbilitySchema` values with zero `fixtures/memory/<task-id>/task.json`
 * coverage across `roots`. Malformed/unparseable task.json files are skipped here —
 * `lintMemoryTaskCorpus` is the dedicated schema-validation gate. */
export async function assertMemoryAbilityCoverage(roots: string[]): Promise<IMemoryAbilityCoverageResult> {
  const present = new Set<string>();

  for (const root of roots) {
    for (const taskDir of readTaskDirs(root)) {
      let raw;
      try {
        raw = JSON.parse(await Deno.readTextFile(join(taskDir, "task.json")));
      } catch {
        continue;
      }
      const parsed = MemoryTaskJsonSchema.safeParse(raw);
      if (parsed.success) present.add(parsed.data.ability);
    }
  }

  return { missing: MemoryAbilitySchema.options.filter((ability) => !present.has(ability)) };
}
