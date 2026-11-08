/**
 * @module DecisionEventScenariosTest
 * @path tests/scenario_framework/tests/unit/decision_event_scenarios_test.ts
 * @description Proves that the journal assertions of the tool confirmation denial scenario and the request cancel scenario fail when their event is missing or wrong, so removing the event cannot leave either scenario green.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/yaml, @db/sqlite, tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/schema/step_schema.ts]
 * @related-files [tests/scenario_framework/scenarios/dynamic_execution/dynamic-tool-confirmation-denial.yaml, tests/scenario_framework/scenarios/flow_blueprints/request_cancel.yaml]
 */

import * as pathBuilders from "@exaix/shared";
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse } from "@std/yaml";
import { Database } from "@db/sqlite";
import { withTempDir } from "@exaix/testing";
import { executeScenarioStep } from "../../runner/step_executor.ts";
import { ScenarioStepSchema } from "../../schema/step_schema.ts";

const FRAMEWORK_HOME = join(import.meta.dirname!, "..", "..");
const DENIAL_SCENARIO = join(FRAMEWORK_HOME, "scenarios", "dynamic_execution", "dynamic-tool-confirmation-denial.yaml");
const CANCEL_SCENARIO = join(FRAMEWORK_HOME, "scenarios", "flow_blueprints", "request_cancel.yaml");
const DENIAL_STEP_ID = "assert-decision-journaled";
const CANCEL_STEP_ID = "assert-cancel-journaled";
const CONFIRMATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const TRACE = "trace-cancel-scenario";
const PASS = 0;
const FAIL = 1;

type JournalRow = readonly [traceId: string, actionType: string, payload: string];

interface IScenarioFile {
  steps: Array<{ id: string }>;
}

async function stepOf(scenarioPath: string, stepId: string) {
  const scenario = parse(await Deno.readTextFile(scenarioPath)) as IScenarioFile;
  const step = scenario.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) throw new Error(`step ${stepId} is not in ${scenarioPath}`);
  return ScenarioStepSchema.parse(step);
}

async function exitCodeOver(rows: readonly JournalRow[], scenarioPath: string, stepId: string): Promise<number> {
  const step = await stepOf(scenarioPath, stepId);
  let exitCode = -1;
  await withTempDir(async (workspace) => {
    await Deno.mkdir(pathBuilders.runtimePath(workspace), { recursive: true });
    const db = new Database(pathBuilders.runtimePath(workspace, "journal.db"));
    db.prepare("CREATE TABLE activity (rowid INTEGER PRIMARY KEY, trace_id TEXT, action_type TEXT, payload TEXT)")
      .run();
    for (const [traceId, actionType, payload] of rows) {
      db.prepare("INSERT INTO activity (trace_id, action_type, payload) VALUES (?, ?, ?)").run(
        traceId,
        actionType,
        payload,
      );
    }
    db.close();
    exitCode = (await executeScenarioStep({ step, cwd: workspace })).exitCode;
  }, { prefix: "decision-scenarios-" });
  return exitCode;
}

function denial(overrides: Record<string, string | boolean | null> = {}): JournalRow {
  return [
    "trace-tool",
    "tool_confirmation.decided",
    JSON.stringify({
      confirmation_id: CONFIRMATION_ID,
      approved: false,
      reason: "Denied by scenario framework",
      ...overrides,
    }),
  ];
}

function cancelled(overrides: Record<string, string | null> = {}): JournalRow {
  return [
    TRACE,
    "request.cancelled",
    JSON.stringify({
      request_id: TRACE,
      previous_status: "pending",
      reason: "Cancelled by scenario framework",
      ...overrides,
    }),
  ];
}

const REQUEST_CREATED: JournalRow = [TRACE, "request.created", "{}"];

Deno.test("the denial scenario passes when tool_confirmation.decided holds the denial", async () => {
  assertEquals(await exitCodeOver([denial()], DENIAL_SCENARIO, DENIAL_STEP_ID), PASS);
});

Deno.test("the denial scenario fails when tool_confirmation.decided is missing", async () => {
  assertEquals(await exitCodeOver([], DENIAL_SCENARIO, DENIAL_STEP_ID), FAIL);
});

Deno.test("the denial scenario fails when the decision is an approval or names another reason", async () => {
  assertEquals(await exitCodeOver([denial({ approved: true })], DENIAL_SCENARIO, DENIAL_STEP_ID), FAIL);
  assertEquals(await exitCodeOver([denial({ reason: "Other" })], DENIAL_SCENARIO, DENIAL_STEP_ID), FAIL);
  assertEquals(await exitCodeOver([denial(), denial()], DENIAL_SCENARIO, DENIAL_STEP_ID), FAIL);
});

Deno.test("the cancel scenario passes when request.cancelled follows the request", async () => {
  assertEquals(await exitCodeOver([REQUEST_CREATED, cancelled()], CANCEL_SCENARIO, CANCEL_STEP_ID), PASS);
});

Deno.test("the cancel scenario fails when request.cancelled is missing", async () => {
  assertEquals(await exitCodeOver([REQUEST_CREATED], CANCEL_SCENARIO, CANCEL_STEP_ID), FAIL);
});

Deno.test("the cancel scenario fails for another status, another reason or another trace", async () => {
  assertEquals(
    await exitCodeOver(
      [REQUEST_CREATED, cancelled({ previous_status: "needs_clarification" })],
      CANCEL_SCENARIO,
      CANCEL_STEP_ID,
    ),
    FAIL,
  );
  assertEquals(
    await exitCodeOver([REQUEST_CREATED, cancelled({ reason: null })], CANCEL_SCENARIO, CANCEL_STEP_ID),
    FAIL,
  );
  const elsewhere: JournalRow = ["other-trace", "request.cancelled", cancelled()[2]];
  assertEquals(await exitCodeOver([REQUEST_CREATED, elsewhere], CANCEL_SCENARIO, CANCEL_STEP_ID), FAIL);
});
