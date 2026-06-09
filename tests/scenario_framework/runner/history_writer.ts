/**
 * @module ScenarioFrameworkHistoryWriter
 * @path tests/scenario_framework/runner/history_writer.ts
 * @description Implements eval history JSONL writing with atomic append
 * to both scenario-specific and global history files.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/history_schema.ts, tests/scenario_framework/tests/unit/history_writer_test.ts]
 */

import { dirname, resolve } from "@std/path";
import {
  EvalHistoryEntrySchema,
  getDefaultComponentVersions,
  type IEvalHistoryEntry,
} from "../schema/history_schema.ts";
import type { IRunManifest } from "./evidence_collector.ts";

export interface IWriteEvalHistoryOptions {
  outputDir: string;
  scenarioId: string;
  manifest: IRunManifest;
}

const GLOBAL_HISTORY_DIR = "history";
const HISTORY_FILE = "eval-history.jsonl";

/**
 * Writes an eval history entry to both scenario-specific and global history files.
 * Uses atomic append: writes to a temp file in the same directory, then renames.
 */
export async function writeEvalHistoryEntry(options: IWriteEvalHistoryOptions): Promise<IEvalHistoryEntry> {
  const entry = buildEvalHistoryEntry(options.manifest);

  const parsed = EvalHistoryEntrySchema.parse(entry);

  // Scenario-specific history
  const scenarioDir = resolve(options.outputDir, GLOBAL_HISTORY_DIR, options.scenarioId);
  await writeJsonlLine(scenarioDir, parsed);

  // Global history
  const globalDir = resolve(options.outputDir, GLOBAL_HISTORY_DIR);
  await writeJsonlLine(globalDir, parsed);

  return parsed;
}

function buildEvalHistoryEntry(manifest: IRunManifest): IEvalHistoryEntry {
  return {
    run_id: crypto.randomUUID(),
    scenario_id: manifest.scenarioId,
    pack: manifest.pack,
    outcome: manifest.outcome,
    mode: manifest.mode,
    suite_score: manifest.suite_score,
    step_count: manifest.steps.length,
    step_results: manifest.steps.map((s) => ({
      step_id: s.stepId,
      score: s.score ??
        (s.criterionResults.length > 0
          ? s.criterionResults.filter((c) => c.status === "passed").length / s.criterionResults.length
          : 1.0),
      criteria_passed: s.criterionResults.filter((c) => c.status === "passed").length,
      criteria_total: s.criterionResults.length,
    })),
    passed: manifest.outcome === "success",
    timestamp: new Date().toISOString(),
    component_versions: getDefaultComponentVersions(),
  };
}

/**
 * Atomically appends a JSONL line to a file in the given directory.
 * Writes to a temp file first, then renames to avoid partial writes.
 */
async function writeJsonlLine(directory: string, entry: IEvalHistoryEntry): Promise<void> {
  const historyPath = resolve(directory, HISTORY_FILE);
  await Deno.mkdir(dirname(historyPath), { recursive: true });

  const line = JSON.stringify(entry) + "\n";
  const tempPath = historyPath + ".tmp";

  // Read existing content if file exists, then write atomically
  let existing = "";
  try {
    existing = await Deno.readTextFile(historyPath);
  } catch {
    // File doesn't exist yet — that's fine
  }

  await Deno.writeTextFile(tempPath, existing + line);
  await Deno.rename(tempPath, historyPath);
}
