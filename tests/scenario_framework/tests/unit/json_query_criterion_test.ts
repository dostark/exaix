/**
 * @module ScenarioFrameworkJsonQueryCriterionTest
 * @path tests/scenario_framework/tests/unit/json_query_criterion_test.ts
 * @description Verifies `evaluateCriterion`'s JSON_QUERY handling of the leading-dot
 *   array-map query syntax (`.[].field`), used throughout the scenario catalog to
 *   project a field across every element of a journal-query JSON array. Two real bugs
 *   were found while investigating a Phase 135 Step 9 scenario failure: (1) the query
 *   parser split `.[].field` into `["", "[]", "field"]`, and the leading empty segment
 *   indexed the array with key `""`, collapsing every such query to `undefined`
 *   regardless of the underlying data (silently broken for 7+ scenario files across
 *   the catalog); (2) the `contains` check then called `.includes()` on
 *   `JSON.stringify(undefined)` (the JS value `undefined`, not the string
 *   `"undefined"`), throwing and reporting a misleading `status: error` /
 *   "Failed to evaluate JSON query" instead of a clean pass/fail.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/scenarios/agent_flows/model_registry_team_cutover.yaml]
 */

import { assertEquals } from "@std/assert";
import { evaluateCriterion } from "../../runner/assertions.ts";
import { CriterionKind, CriterionPhase, CriterionStatus } from "../../schema/step_schema.ts";
import type { IScenarioStepExecutionResult } from "../../runner/step_executor.ts";

function executionResultWithStdout(stdout: string): IScenarioStepExecutionResult {
  return {
    stepId: "step",
    stepType: "exactl" as IScenarioStepExecutionResult["stepType"],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 0,
    exitCode: 0,
    stdout,
    stderr: "",
    combinedOutput: stdout,
  };
}

const JOURNAL_ARRAY = JSON.stringify([
  { action_type: "model.resolved", payload: '{"reason":"best_ranked"}' },
  { action_type: "model.resolved", payload: '{"reason":"preferred_list"}' },
]);

Deno.test("[JsonQueryCriterion] '.[].field' projects the field across every array element (leading-dot array-map syntax)", async () => {
  const result = await evaluateCriterion({
    workspaceRoot: "/tmp",
    phase: CriterionPhase.OUTPUT,
    criterion: {
      id: "action-type-present",
      kind: CriterionKind.JSON_QUERY,
      query: ".[].action_type",
      contains: ["model.resolved"],
    },
    executionResult: executionResultWithStdout(JOURNAL_ARRAY),
  });

  assertEquals(result.status, CriterionStatus.PASSED);
});

Deno.test("[JsonQueryCriterion] '.[].field' contains-check correctly fails (not errors) when the value is genuinely absent", async () => {
  const result = await evaluateCriterion({
    workspaceRoot: "/tmp",
    phase: CriterionPhase.OUTPUT,
    criterion: {
      id: "reason-not-present",
      kind: CriterionKind.JSON_QUERY,
      query: ".[].payload",
      contains: ["nonexistent_reason"],
    },
    executionResult: executionResultWithStdout(JOURNAL_ARRAY),
  });

  assertEquals(result.status, CriterionStatus.FAILED);
});

Deno.test("[JsonQueryCriterion] '.[].field' over an EMPTY array fails cleanly (not status: error) when contains is expected", async () => {
  const result = await evaluateCriterion({
    workspaceRoot: "/tmp",
    phase: CriterionPhase.OUTPUT,
    criterion: {
      id: "action-type-present",
      kind: CriterionKind.JSON_QUERY,
      query: ".[].action_type",
      contains: ["model.resolved"],
    },
    executionResult: executionResultWithStdout("[]"),
  });

  assertEquals(result.status, CriterionStatus.FAILED);
});
