/**
 * @module MemoryCorpusLint
 * @path tests/scenario_framework/runner/memory_corpus_lint.ts
 * @description Bulk-validation of fixtures/memory task corpora against
 * `MemoryTaskJsonSchema`, plus one ability-conditional structural check no schema
 * constraint alone can express: a non-abstention task's every query must carry at
 * least one ground-truth id, while an abstention task's every query must carry
 * exactly zero (per pre-gap analysis GAP-1 — a blanket "every task has ground
 * truth" rule would reject Step 2's abstention fixtures). Mirrors corpus_lint.ts's
 * read-dirs -> safeParse -> collect-errors shape.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/memory_task_schema.ts, tests/scenario_framework/tests/unit/memory_corpus_lint_test.ts]
 */

import { join } from "@std/path";
import { MemoryTaskJsonSchema } from "../schema/memory_task_schema.ts";

export interface ICorpusLintResult {
  errors: string[];
}

function readTaskDirs(root: string): Map<string, string> {
  const dirs = new Map<string, string>();
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(root)];
  } catch {
    return dirs;
  }
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    dirs.set(entry.name, join(root, entry.name));
  }
  return dirs;
}

/** Validates every task.json under each root against `MemoryTaskJsonSchema`, then
 * enforces the ability-conditional ground-truth rule. Returns all errors found
 * (empty ⇒ clean). */
export async function lintMemoryTaskCorpus(roots: string[]): Promise<ICorpusLintResult> {
  const errors: string[] = [];

  for (const root of roots) {
    const taskDirs = readTaskDirs(root);

    for (const [taskId, taskDir] of taskDirs) {
      const taskJsonPath = join(taskDir, "task.json");
      let raw;
      try {
        raw = JSON.parse(await Deno.readTextFile(taskJsonPath));
      } catch (error) {
        errors.push(`${taskId}: could not read/parse task.json (${(error as Error).message})`);
        continue;
      }

      const parsed = MemoryTaskJsonSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push(`${taskId}: schema validation failed: ${parsed.error.message}`);
        continue;
      }

      const isAbstention = parsed.data.ability === "abstention";
      for (const [index, query] of parsed.data.queries.entries()) {
        if (isAbstention && query.ground_truth_ids.length > 0) {
          errors.push(
            `${taskId}: query[${index}] is on an abstention-ability task but has ${query.ground_truth_ids.length} ground-truth id(s) — abstention queries must have zero`,
          );
        }
        if (!isAbstention && query.ground_truth_ids.length === 0) {
          errors.push(
            `${taskId}: query[${index}] has no ground-truth ids but ability is "${parsed.data.ability}", not "abstention"`,
          );
        }
      }
    }
  }

  return { errors };
}
