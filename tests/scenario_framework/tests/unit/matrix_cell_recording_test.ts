// deno-lint-ignore-file no-explicit-any
/**
 * @module MatrixCellRecordingTest
 * @path tests/scenario_framework/tests/unit/matrix_cell_recording_test.ts
 * @description Tests that matrix cell identity (cell_id, provider, model)
 * is recorded in the run manifest and propagated through writeEvalHistoryEntry
 * into the eval history entry and SQLite store.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EvalSqliteStore } from "@exaix/eval-history";
import { buildRunManifest } from "../../runner/synthetic_runner.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";
import { writeEvalHistoryEntry } from "../../runner/history_writer.ts";

function makeLoadedScenario(id: string) {
  return {
    scenario: { id, pack: "swe_tasks", title: "test", steps: [], portals: [], request_fixture: "", mode_support: [] },
    steps: [],
    requestFixture: { id: "req", title: "test", body: "test" },
    absoluteScenarioPath: "/tmp/test.yaml",
  } as any;
}

Deno.test({
  name: "[MatrixCellRecording] buildRunManifest includes cell identity when provided",
  fn: () => {
    const manifest = buildRunManifest({
      loadedScenario: makeLoadedScenario("cell-test"),
      stepOutcomes: [],
      runResult: { scenarioFailed: false, stepOutcomes: [], executionError: null },
      mode: "auto",
      matrixCell: { cellId: "mock-cell-1", provider: "mock", model: "mock-model-v1" },
    } as any);

    assertEquals(manifest.cellId, "mock-cell-1");
    assertEquals(manifest.provider, "mock");
    assertEquals(manifest.model, "mock-model-v1");
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[MatrixCellRecording] buildRunManifest omits cell identity when not provided",
  fn: () => {
    const manifest = buildRunManifest({
      loadedScenario: makeLoadedScenario("no-cell-test"),
      stepOutcomes: [],
      runResult: { scenarioFailed: false, stepOutcomes: [], executionError: null },
      mode: "auto",
    } as any);

    assertEquals(manifest.cellId, undefined);
    assertEquals(manifest.provider, undefined);
    assertEquals(manifest.model, undefined);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "[MatrixCellRecording] cell identity from manifest propagates through writeEvalHistoryEntry into history entry and SQLite",
  fn: async () => {
    const dir = Deno.makeTempDirSync({ prefix: "scenario-framework-cell-rec-" });
    const dbPath = join(dir, ".exa", "eval.db");
    const store = new EvalSqliteStore(dbPath);
    try {
      store.initialize();

      const manifest: IRunManifest = {
        scenarioId: "propagation-test",
        pack: "swe_tasks",
        mode: "auto",
        outcome: "success",
        suite_score: 0.9,
        steps: [],
        cellId: "mock-cell-2",
        provider: "openai",
        model: "gpt-4",
      };

      const entry = await writeEvalHistoryEntry({
        outputDir: dir,
        scenarioId: "propagation-test",
        manifest,
        cellId: manifest.cellId,
        provider: manifest.provider,
        model: manifest.model,
      });

      // Verify entry has the cell fields
      assertEquals(entry.cell_id, "mock-cell-2");
      assertEquals(entry.provider, "openai");
      assertEquals(entry.model, "gpt-4");

      // Verify SQLite persistence
      store.writeRun(entry, []);
      const runs = store.queryRuns({ scenario: "propagation-test" });
      assertEquals(runs.length, 1);
      assertEquals(runs[0].cell_id, "mock-cell-2");
      assertEquals(runs[0].provider, "openai");
      assertEquals(runs[0].model, "gpt-4");
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
