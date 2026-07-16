/**
 * @module HistoryBackendConsistencyTest
 * @path tests/scenario_framework/tests/unit/history_backend_consistency_test.ts
 * @description Integration test: after writing via writeEvalHistoryEntry (JSONL)
 * and EvalSqliteStore.writeRun, both backends list the same run ids.
 */

import { assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { EvalSqliteStore, type IEvalHistoryEntry } from "@exaix/eval-history";
import { writeEvalHistoryEntry } from "../../runner/history_writer.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";

function makeManifest(scenarioId: string, suiteScore: number, outcome: string): IRunManifest {
  return {
    scenarioId,
    pack: "smoke",
    outcome,
    mode: "auto",
    suite_score: suiteScore,
    steps: [],
  };
}

Deno.test({
  name: "[HistoryBackend] JSONL and SQLite backends share the same run ids after write",
  fn: async () => {
    const dir = Deno.makeTempDirSync({ prefix: "scenario-framework-backend-consist-" });
    // Create the .exa directory before constructing the store (constructor opens the DB)
    Deno.mkdirSync(join(dir, ".exa"), { recursive: true });
    const dbPath = join(dir, ".exa", "eval.db");
    const store = new EvalSqliteStore(dbPath);
    try {
      store.initialize();

      // Write 3 entries via history_writer (JSONL) + store (SQLite)
      const scenarioIds = ["scenario-a", "scenario-b", "scenario-c"];
      const entries: IEvalHistoryEntry[] = [];

      for (let i = 0; i < scenarioIds.length; i++) {
        const sid = scenarioIds[i];
        const score = 0.5 + i * 0.2;
        const outcome = score >= 0.7 ? "success" : "failure";
        const entry = await writeEvalHistoryEntry({
          outputDir: dir,
          scenarioId: sid,
          manifest: makeManifest(sid, score, outcome),
        });
        entries.push(entry);

        store.writeRun(entry, [{
          stepId: "step-1",
          score,
          executionStatus: "completed",
        }]);
      }

      // Read back from SQLite
      const sqliteRuns = store.queryRuns({});
      assertEquals(sqliteRuns.length, 3);

      // Read back from JSONL
      const globalFile = resolve(dir, "history", "eval-history.jsonl");
      const content = await Deno.readTextFile(globalFile);
      const jsonlLines = content.trim().split("\n").filter(Boolean);
      assertEquals(jsonlLines.length, 3);

      // Verify same run ids appear in both backends
      const jsonlRunIds = jsonlLines.map((l) => JSON.parse(l).run_id).sort();
      const sqliteRunIds = sqliteRuns.map((r) => r.run_id).sort();
      assertEquals(jsonlRunIds, sqliteRunIds);
    } finally {
      store.close();
      try {
        Deno.removeSync(dir, { recursive: true });
      } catch { /* ok */ }
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
