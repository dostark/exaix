/**
 * @module EvalReportFamiliesViewTest
 * @path apps/exactl/tests/eval_report_families_view_test.ts
 * @description Tests for `exactl eval report --view families`: the `--format json` output is
 *   one parseable array of per-family summary rows.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts, packages/eval-history/src/history_sqlite.ts]
 */

import * as pathBuilders from "@exaix/shared";
import { assertEquals } from "@std/assert";
import { EvalScoringMode } from "@exaix/core";
import { EvalSqliteStore, type IFamilySummaryRow } from "@exaix/eval-history";
import { EvalCommands } from "../src/commands/eval_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { withCapturedOutput } from "./helpers/captured_output.ts";

function seedRun(store: EvalSqliteStore, runId: string, scenarioId: string, score: number): void {
  store.writeRun({
    run_id: runId,
    scenario_id: scenarioId,
    pack: "swe_tasks",
    tags: ["task:bug-fix"],
    outcome: "success",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: score,
    passed: true,
    timestamp: new Date().toISOString(),
    cell_id: "cell-a",
  }, []);
}

Deno.test("[EvalReportFamiliesView] --format json renders parseable family rows", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = pathBuilders.runtimePath(tempDir, "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();
  seedRun(store, "run-1", "t1", 0.8);
  seedRun(store, "run-2", "t2", 0.6);
  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "families", format: "json", dbPath }));
  const parsed = JSON.parse(output.join("\n")) as IFamilySummaryRow[];
  assertEquals(parsed.length, 1, "one family row in json");
  assertEquals(parsed[0].taskCount, 2, "both tasks count toward the family");
  await cleanup();
});
