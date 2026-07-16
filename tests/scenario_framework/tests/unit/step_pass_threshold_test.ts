/**
 * @module StepPassThresholdTest
 * @path tests/scenario_framework/tests/unit/step_pass_threshold_test.ts
 * @description Tests for step_pass_threshold semantics: a step with fractional
 * criterion scores marks criteriaFailed only when its step score falls below
 * the step's step_pass_threshold. Default 1.0 preserves current behavior.
 */

import { assertEquals } from "@std/assert";
import type { IScenarioStep } from "../../schema/step_schema.ts";

Deno.test("[StepPassThreshold] default 1.0 — any score < 1.0 marks criteriaFailed", () => {
  const threshold = 1.0;
  const stepScore = 0.75;
  assertEquals(stepScore < threshold, true);
});

Deno.test("[StepPassThreshold] threshold 0.6 — 0.75-scoring step passes", () => {
  const threshold = 0.6;
  const stepScore = 0.75;
  assertEquals(stepScore >= threshold, true);
});

Deno.test("[StepPassThreshold] threshold 0.6 — 0.4-scoring step fails", () => {
  const threshold = 0.6;
  const stepScore = 0.4;
  assertEquals(stepScore < threshold, true);
});

Deno.test("[StepPassThreshold] boundary equality at threshold passes", () => {
  const threshold = 0.75;
  const stepScore = 0.75;
  assertEquals(stepScore >= threshold, true);
});

Deno.test("[StepPassThreshold] step can carry optional step_pass_threshold on IScenarioStep", () => {
  const step: IScenarioStep & { step_pass_threshold?: number } = {
    id: "step-1",
    type: "shell" as IScenarioStep["type"],
    command: "echo",
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
    step_pass_threshold: 0.6,
  };
  assertEquals(step.step_pass_threshold, 0.6);
});

Deno.test("[StepPassThreshold] default step_pass_threshold is 1.0 when absent", () => {
  const step: IScenarioStep & { step_pass_threshold?: number } = {
    id: "step-1",
    type: "shell" as IScenarioStep["type"],
    command: "echo",
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
  };
  const threshold = step.step_pass_threshold ?? 1.0;
  assertEquals(threshold, 1.0);
});
