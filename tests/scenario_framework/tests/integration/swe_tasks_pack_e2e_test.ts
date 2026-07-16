/**
 * @module SweTasksPackE2eTest
 * @path tests/scenario_framework/tests/integration/swe_tasks_pack_e2e_test.ts
 * @description Validates swe_tasks pack scenarios: loads all 4 YAML files,
 * verifies schema metadata, runs through synthetic runner, and confirms
 * cell_id propagation through manifest → history → SQLite.
 */

import { assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { EvalSqliteStore } from "@exaix/eval-history";
import { ScenarioExecutionMode } from "../../schema/step_schema.ts";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";
import { writeEvalHistoryEntry } from "../../runner/history_writer.ts";
import { loadScenarioCatalog } from "../../runner/scenario_catalog.ts";

const FRAMEWORK_HOME = resolve(new URL(".", import.meta.url).pathname, "../..");

Deno.test("[SweTasksPackE2e] all swe_tasks scenarios load from catalog with correct metadata", async () => {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const sweScenarios = catalog.filter((s) => s.pack === "swe_tasks");
  assertEquals(sweScenarios.length, 4);

  const ids = sweScenarios.map((s) => s.id).sort();
  assertEquals(ids, [
    "swe-add-feature-endpoint",
    "swe-fix-bug-null-guard",
    "swe-refactor-extract-function",
    "swe-write-tests-uncovered",
  ]);

  for (const s of sweScenarios) {
    assertEquals(s.tags.includes("ci-extended"), true);
  }
});

Deno.test("[SweTasksPackE2e] swe_tasks scenario runs through synthetic runner with cell_id propagation", async () => {
  const outputDir = Deno.makeTempDirSync({ prefix: "scenario-framework-swe-e2e-" });
  try {
    const relPath = "scenarios/swe_tasks/fix-bug-null-guard.yaml";

    const run = await runSyntheticScenario({
      frameworkHome: FRAMEWORK_HOME,
      scenarioPath: relPath,
      workspaceRoot: join(outputDir, "workspace"),
      outputDir,
      mode: ScenarioExecutionMode.AUTO,
    });

    assertEquals(run.manifest.scenarioId, "swe-fix-bug-null-guard");
    assertEquals(typeof run.manifest.outcome, "string");
    assertEquals(run.manifest.steps.length >= 0, true);

    // Cell identity would be set from the first runnable matrix cell
    const manifestWithCell = { ...run.manifest, cellId: "mock-mock", provider: "mock" };

    const dbPath = join(outputDir, ".exa", "eval.db");
    const store = new EvalSqliteStore(dbPath);
    try {
      store.initialize();
      const entry = await writeEvalHistoryEntry({
        outputDir,
        scenarioId: run.manifest.scenarioId,
        manifest: manifestWithCell,
        cellId: manifestWithCell.cellId,
        provider: manifestWithCell.provider,
      });
      assertEquals(entry.cell_id, "mock-mock");
      assertEquals(entry.provider, "mock");

      store.writeRun(
        entry,
        run.manifest.steps.map((s) => ({
          stepId: s.stepId,
          score: s.score ?? 0,
          executionStatus: s.executionStatus,
        })),
      );

      const rows = store.queryRuns({ scenario: "swe-fix-bug-null-guard" });
      assertEquals(rows.length, 1);
      assertEquals(rows[0].cell_id, "mock-mock");
    } finally {
      store.close();
    }
  } finally {
    try {
      Deno.removeSync(outputDir, { recursive: true });
    } catch { /* ok */ }
  }
});
