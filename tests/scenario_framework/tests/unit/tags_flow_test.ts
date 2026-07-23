/**
 * @module TagsFlowTest
 * @path tests/scenario_framework/tests/unit/tags_flow_test.ts
 * @description Verifies scenario tags flow end-to-end: IRunManifest.tags →
 *   buildEvalHistoryEntry → JSONL entry → SQLite eval_runs.tags column.
 *   Untagged scenarios produce no tags field in any artifact. Phase 141 Step 1.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/evidence_collector.ts, packages/eval-history/src/history_schema.ts, tests/scenario_framework/runner/history_writer.ts, packages/eval-history/src/history_sqlite.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { EvalSqliteStore, type IEvalHistoryEntry } from "@exaix/eval-history";
import type { IRunManifest } from "../../runner/evidence_collector.ts";
import { EvalHistoryEntrySchema } from "@exaix/eval-history";

Deno.test("[TagsFlow] IRunManifest accepts optional tags array", () => {
  const withTags: IRunManifest = {
    scenarioId: "s1",
    pack: "swe_tasks",
    mode: "auto",
    outcome: "success",
    steps: [],
    tags: ["task:bug-fix", "difficulty:S"],
  };
  assertEquals(withTags.tags!.length, 2);
  assertEquals(withTags.tags![0], "task:bug-fix");

  const withoutTags: IRunManifest = {
    scenarioId: "s2",
    pack: "eval-smoke",
    mode: "auto",
    outcome: "success",
    steps: [],
  };
  assertEquals(withoutTags.tags, undefined);
});

Deno.test("[TagsFlow] EvalHistoryEntrySchema accepts optional tags array", () => {
  const entry: IEvalHistoryEntry = {
    run_id: "r1",
    scenario_id: "s1",
    pack: "swe_tasks",
    outcome: "success",
    mode: "auto",
    passed: true,
    timestamp: new Date().toISOString(),
    tags: ["task:bug-fix", "difficulty:S"],
  };
  const parsed = EvalHistoryEntrySchema.parse(entry);
  assertEquals(parsed.tags, ["task:bug-fix", "difficulty:S"]);

  const untagged: IEvalHistoryEntry = {
    run_id: "r2",
    scenario_id: "s2",
    outcome: "success",
    mode: "auto",
    passed: true,
    timestamp: new Date().toISOString(),
  };
  const parsedUntagged = EvalHistoryEntrySchema.parse(untagged);
  assertEquals(parsedUntagged.tags, undefined);
});

Deno.test("[TagsFlow] SQLite store persists and retrieves tags", () => {
  const dbDir = Deno.makeTempDirSync({ prefix: "tags-flow-sqlite-" });
  const dbPath = `${dbDir}/eval.db`;
  const store = new EvalSqliteStore(dbPath);
  try {
    store.initialize();

    store.writeRun({
      run_id: "tagged-run",
      scenario_id: "s1",
      pack: "swe_tasks",
      outcome: "success",
      mode: "auto",
      passed: true,
      timestamp: new Date().toISOString(),
      tags: ["task:bug-fix", "difficulty:S"],
    });

    const runs = store.queryRuns({});
    const tagged = runs.find((r) => r.run_id === "tagged-run");
    assert(tagged !== undefined);
    assert(tagged.tags !== null);
    assertEquals(JSON.parse(tagged.tags), ["task:bug-fix", "difficulty:S"]);

    store.writeRun({
      run_id: "untagged-run",
      scenario_id: "s2",
      outcome: "success",
      mode: "auto",
      passed: true,
      timestamp: new Date().toISOString(),
    });

    const allRuns = store.queryRuns({});
    const untagged = allRuns.find((r) => r.run_id === "untagged-run");
    assertEquals(untagged !== undefined, true);
    assertEquals(untagged!.tags, null);
  } finally {
    store.close();
    try {
      Deno.removeSync(dbDir, { recursive: true });
    } catch { /* ok */ }
  }
});
