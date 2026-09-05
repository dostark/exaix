/**
 * @module ScenarioFrameworkCorpusLint
 * @path tests/scenario_framework/runner/corpus_lint.ts
 * @description Bulk-validation of task-fixture corpora against `TaskJsonSchema`, plus two
 *   adversarial-pack-specific checks no prior corpus lint performed: an attacked task's
 *   `attack.twin_of` must resolve to a sibling task directory, and every fixture file under a
 *   task directory must not contain a string shaped like a real secret — canary fixtures must
 *   use the `CANARY-<uuid>` convention instead. No equivalent bulk pass over the real fixture
 *   corpus existed before Phase 145 Step 1; `TaskJsonSchema` was previously only exercised
 *   against inline test objects.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/task_schema.ts, tests/scenario_framework/tests/unit/corpus_lint_test.ts]
 */

import { join } from "@std/path";
import { TaskJsonSchema } from "../schema/task_schema.ts";

export interface ICorpusLintResult {
  errors: string[];
}

/** Secret-shaped patterns a canary fixture must never match (AWS access key id, OpenAI-style key). */
const SECRET_SHAPE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "AWS access key id", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "OpenAI-style secret key", pattern: /sk-[a-zA-Z0-9]{32,}/ },
];

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

async function checkSecretShapes(taskDir: string, taskId: string, errors: string[]): Promise<void> {
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(taskDir)];
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile) continue;
    const filePath = join(taskDir, entry.name);
    let content: string;
    try {
      content = await Deno.readTextFile(filePath);
    } catch {
      continue;
    }
    for (const { name, pattern } of SECRET_SHAPE_PATTERNS) {
      if (pattern.test(content)) {
        errors.push(
          `${taskId}: file "${entry.name}" contains a secret-shaped string (looks like a ${name}) — ` +
            `canary fixtures must use the CANARY-<uuid> convention instead`,
        );
      }
    }
  }
}

/** Validates every task.json under each root against `TaskJsonSchema`, cross-checks attacked
 *  tasks' `attack.twin_of` against sibling directories in the SAME root, and scans every fixture
 *  file in a task directory for secret-shaped content. Returns all errors found (empty ⇒ clean). */
export async function lintTaskCorpus(roots: string[]): Promise<ICorpusLintResult> {
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

      const parsed = TaskJsonSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push(`${taskId}: schema validation failed: ${parsed.error.message}`);
        continue;
      }

      if (parsed.data.attack && !taskDirs.has(parsed.data.attack.twin_of)) {
        errors.push(
          `${taskId}: attack.twin_of "${parsed.data.attack.twin_of}" not found as a sibling task directory in ${root}`,
        );
      }

      await checkSecretShapes(taskDir, taskId, errors);
    }
  }

  return { errors };
}
