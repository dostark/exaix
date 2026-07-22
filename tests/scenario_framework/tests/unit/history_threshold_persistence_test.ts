/**
 * @module HistoryThresholdPersistenceTest
 * @path tests/scenario_framework/tests/unit/history_threshold_persistence_test.ts
 * @description Tests that eval history entries carry score_threshold and
 * threshold-derived passed status in both JSONL and SQLite backends.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EvalHistoryEntrySchema, EvalSqliteStore } from "@exaix/eval-history";
import { writeEvalHistoryEntry } from "../../runner/history_writer.ts";
import { CriterionKind, CriterionPhase, CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";
import type { IRunManifest } from "../../runner/evidence_collector.ts";

function makeTestManifest(overrides: Partial<IRunManifest> = {}): IRunManifest {
  return {
    scenarioId: "threshold-test",
    pack: "smoke",
    mode: "auto",
    outcome: "success",
    steps: [
      {
        stepId: "step-1",
        stepType: ScenarioStepType.SHELL,
        executionStatus: "passed",
        criterionResults: [
          {
            criterion_id: "check-1",
            kind: CriterionKind.FILE_EXISTS,
            phase: CriterionPhase.OUTPUT,
            status: CriterionStatus.PASSED,
            message: "file exists",
            evidence_refs: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

async function withTempDir<T>(prefix: string, fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix });
  try {
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("[HistoryThreshold] JSONL entry carries score_threshold when provided", async () => {
  await withTempDir("scenario-framework-history-", async (outputDir) => {
    const manifest = makeTestManifest({ suite_score: 0.85 });
    const entry = await writeEvalHistoryEntry({
      outputDir,
      scenarioId: "threshold-test",
      manifest,
      scoreThreshold: 0.7,
      thresholdPassed: true,
    });

    assertEquals(entry.score_threshold, 0.7);
    assertEquals(entry.passed, true);

    const parsed = EvalHistoryEntrySchema.parse(entry);
    assertEquals(parsed.score_threshold, 0.7);
  });
});

Deno.test("[HistoryThreshold] JSONL entry score_threshold is absent when not provided", async () => {
  await withTempDir("scenario-framework-history-", async (outputDir) => {
    const manifest = makeTestManifest({ suite_score: 0.85 });
    const entry = await writeEvalHistoryEntry({
      outputDir,
      scenarioId: "threshold-test",
      manifest,
    });

    assertEquals(entry.score_threshold, undefined);
    assertEquals(entry.passed, true);
  });
});

Deno.test("[HistoryThreshold] JSONL entry passed reflects threshold when score below threshold", async () => {
  await withTempDir("scenario-framework-history-", async (outputDir) => {
    const manifest = makeTestManifest({ suite_score: 0.3 });
    const entry = await writeEvalHistoryEntry({
      outputDir,
      scenarioId: "threshold-test",
      manifest,
      scoreThreshold: 0.5,
      thresholdPassed: false,
    });

    assertEquals(entry.score_threshold, 0.5);
    assertEquals(entry.passed, false);
  });
});

Deno.test("[HistoryThreshold] SQLite store persists score_threshold", async () => {
  await withTempDir("scenario-framework-sqlite-", (tmpDir) => {
    const dbPath = join(tmpDir, "eval.db");
    const store = new EvalSqliteStore(dbPath);
    store.initialize();

    const runId = crypto.randomUUID();
    store.writeRun({
      run_id: runId,
      scenario_id: "sqlite-threshold",
      pack: "smoke",
      outcome: "success",
      mode: "auto",
      suite_score: 0.75,
      score_threshold: 0.6,
      passed: true,
      timestamp: new Date().toISOString(),
    });

    const runs = store.queryRuns({ last: 10 });
    const found = runs.find((r) => r.run_id === runId);
    assertEquals(found !== undefined, true);
    assertEquals(found!.score_threshold, 0.6);
    assertEquals(found!.passed, 1);

    store.close();
  });
});

Deno.test("[HistoryThreshold] SQLite store persists passed=false with threshold", async () => {
  await withTempDir("scenario-framework-sqlite-", (tmpDir) => {
    const dbPath = join(tmpDir, "eval.db");
    const store = new EvalSqliteStore(dbPath);
    store.initialize();

    const runId = crypto.randomUUID();
    store.writeRun({
      run_id: runId,
      scenario_id: "sqlite-threshold-fail",
      pack: "smoke",
      outcome: "scenario-failure",
      mode: "auto",
      suite_score: 0.3,
      score_threshold: 0.5,
      passed: false,
      timestamp: new Date().toISOString(),
    });

    const runs = store.queryRuns({ last: 10 });
    const found = runs.find((r) => r.run_id === runId);
    assertEquals(found !== undefined, true);
    assertEquals(found!.score_threshold, 0.5);
    assertEquals(found!.passed, 0);

    store.close();
  });
});

Deno.test("[HistoryThreshold] historical entry without score_threshold still parses", async () => {
  await withTempDir("scenario-framework-history-", async (outputDir) => {
    const manifest = makeTestManifest({ suite_score: 0.5 });
    const entry = await writeEvalHistoryEntry({
      outputDir,
      scenarioId: "legacy-compat",
      manifest,
    });

    const parsed = EvalHistoryEntrySchema.parse(entry);
    assertEquals(parsed.score_threshold, undefined);
    assertEquals(parsed.passed, true);
  });
});
