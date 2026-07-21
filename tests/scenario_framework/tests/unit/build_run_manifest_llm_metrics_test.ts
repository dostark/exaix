// deno-lint-ignore-file no-explicit-any
/**
 * @module BuildRunManifestLlmMetricsTest
 * @path tests/scenario_framework/tests/unit/build_run_manifest_llm_metrics_test.ts
 * @description Phase 140a Step 3 — RED-first tests. buildRunManifest must read each step's
 * llmDurationMs/tokens/trackedCostUsd from the real journal using that step's own
 * stepRowidWindows entry (already computed by synthetic_runner's executeStep callback), not
 * invent new rowid-window bookkeeping. A shell-only step with no LLM call in its window must
 * carry absent/zero metrics without throwing.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, tests/scenario_framework/runner/step_llm_metrics.ts, tests/scenario_framework/runner/evidence_collector.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { Database } from "@db/sqlite";
import { ACTIVITY_TABLE_SQL } from "@exaix/testing/helpers/init_db.ts";
import { buildRunManifest } from "../../runner/synthetic_runner.ts";
import { CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";
import type { IScenarioStepOutcome } from "../../runner/assertions.ts";

async function makeWorkspaceWithJournal(
  testName: string,
): Promise<{ workspaceRoot: string; db: Database; cleanup: () => Promise<void> }> {
  const workspaceRoot = await Deno.makeTempDir({ prefix: `build-manifest-llm-metrics-${testName}-` });
  const exaDir = join(workspaceRoot, ".exa");
  await ensureDir(exaDir);
  const dbPath = join(exaDir, "journal.db");
  const db = new Database(dbPath);
  db.exec(ACTIVITY_TABLE_SQL);
  return {
    workspaceRoot,
    db,
    cleanup: async () => {
      db.close();
      await Deno.remove(workspaceRoot, { recursive: true });
    },
  };
}

function insertExecutionCompleted(db: Database): void {
  db.exec(
    `INSERT INTO activity (id, trace_id, actor, action_type, payload, prompt_tokens, completion_tokens)
     VALUES (?, 'trace-1', 'agent-executor', 'agent.execution_completed', ?, 15, 25)`,
    [
      crypto.randomUUID(),
      JSON.stringify({
        execution_time_ms: 777,
        duration_ms: 777,
        usage: { cost_source: "tracked", cost_usd_estimate: 0.03 },
      }),
    ],
  );
}

function makeLoadedScenario(id: string, steps: Array<{ id: string; type: ScenarioStepType }>) {
  return {
    scenario: { id, pack: "swe_tasks", title: "test", steps: [], portals: [], request_fixture: "", mode_support: [] },
    steps: steps.map((s) => ({
      id: s.id,
      type: s.type,
      continue_on_failure: false,
      input_criteria: [],
      output_criteria: [],
    })),
    requestFixture: { id: "req", title: "test", body: "test" },
    absoluteScenarioPath: "/tmp/test.yaml",
  } as any;
}

function makeStepOutcome(stepId: string): IScenarioStepOutcome {
  return {
    stepId,
    status: CriterionStatus.PASSED,
    failureStage: null,
    criterionResults: [],
  };
}

Deno.test({
  name:
    "[BuildRunManifestLlmMetrics] a step's manifest entry carries llmDurationMs/tokens/trackedCostUsd from its own stepRowidWindows entry",
  fn: async () => {
    const { workspaceRoot, db, cleanup } = await makeWorkspaceWithJournal("wired-step");
    try {
      const sinceRowid = db.prepare("SELECT MAX(rowid) AS m FROM activity").get<{ m: number }>()?.m ?? 0;
      insertExecutionCompleted(db);
      const untilRowid = db.prepare("SELECT MAX(rowid) AS m FROM activity").get<{ m: number }>()!.m;

      const manifest = await buildRunManifest({
        loadedScenario: makeLoadedScenario("llm-metrics-test", [{
          id: "submit-request",
          type: ScenarioStepType.SHELL,
        }]),
        stepOutcomes: [makeStepOutcome("submit-request")],
        runResult: { scenarioFailed: false, stepOutcomes: [], executionError: null },
        mode: "auto",
        workspaceRoot,
        stepRowidWindows: new Map([["submit-request", { start: sinceRowid, end: untilRowid }]]),
      } as any);

      assertEquals(manifest.steps[0].llmDurationMs, 777);
      assertEquals(manifest.steps[0].tokens?.prompt, 15);
      assertEquals(manifest.steps[0].tokens?.completion, 25);
      assertEquals(manifest.steps[0].trackedCostUsd, 0.03);
    } finally {
      await cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "[BuildRunManifestLlmMetrics] a step with no rowid window entry (or no LLM call in it) carries absent metrics without erroring",
  fn: async () => {
    const { workspaceRoot, cleanup } = await makeWorkspaceWithJournal("shell-only-step");
    try {
      const manifest = await buildRunManifest({
        loadedScenario: makeLoadedScenario("shell-only-test", [{ id: "wait-for-file", type: ScenarioStepType.SHELL }]),
        stepOutcomes: [makeStepOutcome("wait-for-file")],
        runResult: { scenarioFailed: false, stepOutcomes: [], executionError: null },
        mode: "auto",
        workspaceRoot,
        stepRowidWindows: new Map(),
      } as any);

      assertEquals(manifest.steps[0].llmDurationMs, undefined);
      assertEquals(manifest.steps[0].tokens, undefined);
      assertEquals(manifest.steps[0].trackedCostUsd, undefined);
    } finally {
      await cleanup();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
