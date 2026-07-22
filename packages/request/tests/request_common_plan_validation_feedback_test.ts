/**
 * @module RequestCommonPlanValidationFeedbackTest
 * @path packages/request/tests/request_common_plan_validation_feedback_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description Verifies buildPlanValidationFeedbackPrompt preserves the original task text
 * and frames the invalid prior output as the model's own attempt, not a new human turn —
 * a live run of swe-add-feature-endpoint showed the prior "YOUR TASK — this is the actual
 * task to complete now" wrapper around the raw rejected content made the model hallucinate
 * an ongoing multi-turn conversation and ask for the original task to be "resent".
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildPlanValidationFeedbackPrompt } from "@exaix/request";

const ORIGINAL_TASK = "Add a `handleCompleteTask(repo, req, res)` handler to src/api.ts.";
const ERROR_MESSAGE = "Invalid JSON: Unexpected token 'I', \"I need to \"... is not valid JSON";
const INVALID_CONTENT = "I need to inspect the repository files before responding.";

Deno.test("buildPlanValidationFeedbackPrompt: preserves the original task text verbatim", () => {
  const prompt = buildPlanValidationFeedbackPrompt(ORIGINAL_TASK, ERROR_MESSAGE, INVALID_CONTENT);
  assertStringIncludes(prompt, ORIGINAL_TASK);
});

Deno.test("buildPlanValidationFeedbackPrompt: labels the invalid content as the model's own previous output, not a new human message", () => {
  const prompt = buildPlanValidationFeedbackPrompt(ORIGINAL_TASK, ERROR_MESSAGE, INVALID_CONTENT);
  // Must not reuse the generic "YOUR TASK" framing for the rejected content — that framing
  // is what caused the model to treat its own prior (bad) output as a fresh instruction.
  const invalidContentIndex = prompt.indexOf(INVALID_CONTENT);
  const taskWrapperIndex = prompt.indexOf("YOUR TASK");
  assertEquals(
    taskWrapperIndex === -1 || invalidContentIndex < taskWrapperIndex || invalidContentIndex === -1,
    true,
    "the rejected content must not fall inside a 'YOUR TASK' labeled block",
  );
  assertStringIncludes(prompt.toLowerCase(), "your immediately preceding response");
});

Deno.test("buildPlanValidationFeedbackPrompt: includes the validation error message", () => {
  const prompt = buildPlanValidationFeedbackPrompt(ORIGINAL_TASK, ERROR_MESSAGE, INVALID_CONTENT);
  assertStringIncludes(prompt, ERROR_MESSAGE);
});

Deno.test("buildPlanValidationFeedbackPrompt: the original task remains the primary instruction (appears before the correction note)", () => {
  const prompt = buildPlanValidationFeedbackPrompt(ORIGINAL_TASK, ERROR_MESSAGE, INVALID_CONTENT);
  const taskIndex = prompt.indexOf(ORIGINAL_TASK);
  const correctionIndex = prompt.indexOf(ERROR_MESSAGE);
  assertEquals(taskIndex !== -1 && correctionIndex !== -1, true);
  assertEquals(taskIndex < correctionIndex, true, "the task must be presented before the correction note");
});
