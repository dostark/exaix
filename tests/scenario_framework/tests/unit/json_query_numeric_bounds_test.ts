/**
 * @module ScenarioFrameworkJsonQueryNumericBoundsTest
 * @path tests/scenario_framework/tests/unit/json_query_numeric_bounds_test.ts
 * @description Phase 142 Step 15 — a `json-query` whose query resolves to a number must have
 *   `min`/`max` compared against that number.
 *
 *   Both bounds were implemented as "length of the result": an array's element count, a string's
 *   character count, and **zero for everything else**. So `query: "length", min: 1` — the obvious
 *   way to say "at least one journal row", and the form three scenarios use — resolved the array's
 *   `length` property to the number 1, fell through to the `else` branch, and scored 0 against a
 *   minimum of 1. The criterion could not pass on any input, and the failure message
 *   ("returned 0 items, expected >= 1" printed beside an observed value of 1) named the symptom
 *   in a way that reads like a missing row rather than a broken comparison.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { evaluateCriterion } from "../../runner/assertions.ts";
import { CriterionKind, CriterionPhase, CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";

const THREE_ROWS = JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }]);

async function evaluate(
  criterion: { query: string; min?: number; max?: number; not_empty?: boolean },
  stdout: string,
): Promise<{ status: CriterionStatus; message?: string }> {
  const result = await evaluateCriterion({
    workspaceRoot: "/tmp",
    phase: CriterionPhase.OUTPUT,
    criterion: {
      id: "bounds",
      kind: CriterionKind.JSON_QUERY,
      score_weight: 1,
      ...criterion,
    },
    executionResult: {
      stepId: "bounds-step",
      stepType: ScenarioStepType.SHELL,
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(0).toISOString(),
      durationMs: 0,
      exitCode: 0,
      stdout,
      stderr: "",
      combinedOutput: stdout,
      criteriaFailed: false,
    },
  });
  return { status: result.status, message: result.message };
}

Deno.test("[json-query] `length` with min passes when the array is long enough", async () => {
  const result = await evaluate({ query: "length", min: 1 }, THREE_ROWS);
  assertEquals(result.status, CriterionStatus.PASSED, result.message);
});

Deno.test("[json-query] `length` with min fails when the array is too short", async () => {
  // The half that must keep working: a numeric comparison that is genuinely below the bound.
  const result = await evaluate({ query: "length", min: 4 }, THREE_ROWS);
  assertEquals(result.status, CriterionStatus.FAILED);
});

Deno.test("[json-query] `length` of an empty array fails a min of 1", async () => {
  const result = await evaluate({ query: "length", min: 1 }, "[]");
  assertEquals(result.status, CriterionStatus.FAILED);
});

Deno.test("[json-query] `length` with max passes when the array is short enough", async () => {
  const result = await evaluate({ query: "length", max: 5 }, THREE_ROWS);
  assertEquals(result.status, CriterionStatus.PASSED, result.message);
});

Deno.test("[json-query] `length` with max fails when the array is too long", async () => {
  const result = await evaluate({ query: "length", max: 2 }, THREE_ROWS);
  assertEquals(result.status, CriterionStatus.FAILED);
});

Deno.test("[json-query] a query returning the array itself still counts elements", async () => {
  // Unchanged behaviour: when the query resolves to the array, `min` means "how many elements".
  const result = await evaluate({ query: ".", min: 3 }, THREE_ROWS);
  assertEquals(result.status, CriterionStatus.PASSED, result.message);
});

Deno.test("[json-query] zero is compared as a value, not treated as an absent result", async () => {
  // The trap in the obvious fix: `if (result)` would send 0 back down the length path and let
  // `max: 0` pass for the wrong reason.
  const belowMin = await evaluate({ query: "length", min: 1 }, "[]");
  assertEquals(belowMin.status, CriterionStatus.FAILED);
  const withinMax = await evaluate({ query: "length", max: 0 }, "[]");
  assertEquals(withinMax.status, CriterionStatus.PASSED, withinMax.message);
});

Deno.test("[json-query] the failure message reports the compared number", async () => {
  const result = await evaluate({ query: "length", min: 9 }, THREE_ROWS);
  assert(result.message?.includes("3"), `message should name the observed 3: ${result.message}`);
});

Deno.test("[json-query] not_empty fails for mapped missing, null, and empty-string values", async () => {
  for (const stdout of ["[{}]", '[{"value":null}]', '[{"value":""}]']) {
    const result = await evaluate({ query: ".[].value", not_empty: true }, stdout);
    assertEquals(result.status, CriterionStatus.FAILED, `${stdout} must fail: ${result.message}`);
  }
});
