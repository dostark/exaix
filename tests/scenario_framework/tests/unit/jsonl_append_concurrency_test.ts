/**
 * @module JsonlAppendConcurrencyTest
 * @path tests/scenario_framework/tests/unit/jsonl_append_concurrency_test.ts
 * @description Tests that concurrent JSONL appends via writeEvalHistoryEntry
 * produce complete entries without data loss.
 */

import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { writeEvalHistoryEntry } from "../../runner/history_writer.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";

function makeManifest(scenarioId: string): IRunManifest {
  return {
    scenarioId,
    pack: "smoke",
    outcome: "success",
    mode: "auto",
    suite_score: 1.0,
    steps: [],
  };
}

Deno.test({
  name: "[JsonlAppend] two concurrent writers produce both entries without loss",
  fn: async () => {
    const dir = Deno.makeTempDirSync({ prefix: "scenario-framework-jsonl-concur-" });
    try {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          writeEvalHistoryEntry({
            outputDir: dir,
            scenarioId: `concur-scenario-${i}`,
            manifest: makeManifest(`concur-scenario-${i}`),
          }),
        );
      }
      await Promise.all(promises);

      // Read global history file — all 10 entries should be present
      const globalFile = resolve(dir, "history", "eval-history.jsonl");
      const content = await Deno.readTextFile(globalFile);
      const lines = content.trim().split("\n").filter(Boolean);
      assertEquals(lines.length, 10);

      // Each line should be valid JSON with a run_id
      for (const line of lines) {
        const parsed = JSON.parse(line);
        assertEquals(typeof parsed.run_id, "string");
        assertEquals(parsed.run_id.length > 0, true);
      }
    } finally {
      try {
        Deno.removeSync(dir, { recursive: true });
      } catch { /* ok */ }
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
