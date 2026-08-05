/**
 * @module EvalReportFailuresViewTest
 * @path apps/exactl/tests/eval_report_failures_view_test.ts
 * @description Phase 143 Step 5 — RED-first test for `exactl eval report --view failures`:
 *   per-class counts with the class × family × cell breakdown and the top class per cell,
 *   aggregated exactly from seeded history runs. `failure_classes` is JSON-stringified in the
 *   row, family comes from the `task:` tag, cell from `cell_id`.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts, packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EvalScoringMode } from "@exaix/core";
import { EvalSqliteStore } from "@exaix/eval-history";
import { EvalCommands } from "../src/commands/eval_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

interface IConsoleArgs extends Array<string | number | boolean | object | undefined | null> {}

function withCapturedOutput<T>(fn: () => T): Promise<{ output: string[]; result: T }> {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: IConsoleArgs) => output.push(args.join(" "));

  const result = fn();
  return Promise.resolve(result)
    .then((resolved) => ({ output, result: resolved }))
    .finally(() => {
      console.log = originalLog;
    });
}

function seedRun(
  store: EvalSqliteStore,
  overrides: {
    runId: string;
    scenarioId: string;
    cellId: string;
    tags: string[];
    score: number;
    failureClasses: string[];
  },
): void {
  store.writeRun({
    run_id: overrides.runId,
    scenario_id: overrides.scenarioId,
    pack: "swe_tasks",
    tags: overrides.tags,
    outcome: "failure",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: overrides.score,
    passed: false,
    timestamp: new Date().toISOString(),
    cell_id: overrides.cellId,
    provider: "anthropic",
    model: "claude-sonnet",
    failure_classes: overrides.failureClasses,
  }, []);
}

Deno.test("[EvalReportFailuresView] renders class × family × cell counts with top class per cell", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();

  // cell-a: two runs with execution.failed on the bug-fix family, one run with execution-alignment.
  seedRun(store, {
    runId: "run-a1",
    scenarioId: "t1",
    cellId: "cell-a",
    tags: ["task:bug-fix"],
    score: 0.4,
    failureClasses: ["execution.failed"],
  });
  seedRun(store, {
    runId: "run-a2",
    scenarioId: "t2",
    cellId: "cell-a",
    tags: ["task:bug-fix"],
    score: 0.3,
    failureClasses: ["execution.failed"],
  });
  seedRun(store, {
    runId: "run-a3",
    scenarioId: "t3",
    cellId: "cell-a",
    tags: ["task:bug-fix"],
    score: 0.4,
    failureClasses: ["execution-alignment"],
  });
  // cell-b: one run with mcp.tool.failed on the refactor family.
  seedRun(store, {
    runId: "run-b1",
    scenarioId: "t4",
    cellId: "cell-b",
    tags: ["task:refactor"],
    score: 0.2,
    failureClasses: ["mcp.tool.failed"],
  });

  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "failures", dbPath }));
  const text = output.join("\n");

  assertStringIncludes(text, "execution.failed", "class must render");
  assertStringIncludes(text, "2", "execution.failed count must render");
  assertStringIncludes(text, "execution-alignment", "execution-alignment class must render");
  assertStringIncludes(text, "mcp.tool.failed", "mcp.tool.failed class must render");
  assertStringIncludes(text, "task:bug-fix", "family must render");
  assertStringIncludes(text, "cell-a", "cell must render");
  assertStringIncludes(text, "cell-b", "cell must render");
  assertStringIncludes(text, "Top class per cell", "top-class-per-cell section must render");
  await cleanup();
});

Deno.test("[EvalReportFailuresView] empty history renders a notice, not a crash", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "failures", dbPath }));
  const text = output.join("\n");
  assertStringIncludes(text, "No", "must render a notice");
  await cleanup();
});

Deno.test("[EvalReportFailuresView] --format json renders machine-readable rows", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  const dbPath = join(tempDir, ".exa", "eval.db");
  const store = new EvalSqliteStore(dbPath);
  store.initialize();
  seedRun(store, {
    runId: "run-a1",
    scenarioId: "t1",
    cellId: "cell-a",
    tags: ["task:bug-fix"],
    score: 0.4,
    failureClasses: ["execution.failed"],
  });
  store.close();

  const cmds = new EvalCommands(context);
  const { output } = await withCapturedOutput(() => cmds.report({ view: "failures", format: "json", dbPath }));
  const parsed = JSON.parse(output.join("\n")) as { classes: Array<{ className: string; count: number }> };
  assertEquals(parsed.classes.length, 1);
  assertEquals(parsed.classes[0].className, "execution.failed");
  assertEquals(parsed.classes[0].count, 1);
  await cleanup();
});
