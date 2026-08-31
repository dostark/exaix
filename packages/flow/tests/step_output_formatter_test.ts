/**
 * @module StepOutputFormatterTest
 * @path packages/flow/tests/step_output_formatter_test.ts
 * @description Direct unit coverage for StepOutputFormatter: transform
 * application (built-in and custom function transforms) and multi-step
 * output aggregation (single/concat/json/markdown formats). Extracted from
 * FlowRunner (god-object decomposition of packages/flow/src/flow_runner.ts).
 * @related-files [packages/flow/src/step_output_formatter.ts, packages/flow/src/flow_runner.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { StepOutputFormatter } from "@exaix/flow";
import type { IStepResult } from "@exaix/flow";
import { FlowOutputFormat } from "@exaix/core";
import type { IFlow } from "@exaix/schemas/flow.ts";

type IFlowOutput = IFlow["output"];

function makeStepResult(content: string): IStepResult {
  return {
    stepId: "step",
    success: true,
    duration: 5,
    startedAt: new Date(),
    completedAt: new Date(),
    result: { thought: "", content, raw: content },
  };
}

Deno.test("[StepOutputFormatter.applyTransform] passthrough returns input unchanged", () => {
  const formatter = new StepOutputFormatter();
  assertEquals(formatter.applyTransform("hello", "passthrough"), "hello");
});

Deno.test("[StepOutputFormatter.applyTransform] mergeAsContext merges array transformArgs", () => {
  const formatter = new StepOutputFormatter();
  const result = formatter.applyTransform("ignored", "mergeAsContext", ["a", "b"]);
  assertEquals(result.includes("a"), true);
  assertEquals(result.includes("b"), true);
});

Deno.test("[StepOutputFormatter.applyTransform] custom function transform is invoked", () => {
  const formatter = new StepOutputFormatter();
  const result = formatter.applyTransform("hello", (input: string) => input.toUpperCase());
  assertEquals(result, "HELLO");
});

Deno.test("[StepOutputFormatter.applyTransform] custom function transform errors are wrapped", () => {
  const formatter = new StepOutputFormatter();
  assertThrows(
    () =>
      formatter.applyTransform("hello", () => {
        throw new Error("boom");
      }),
    Error,
    "Custom transform failed: boom",
  );
});

Deno.test("[StepOutputFormatter.applyTransform] unknown transform name throws", () => {
  const formatter = new StepOutputFormatter();
  assertThrows(() => formatter.applyTransform("hello", "not-a-real-transform"), Error, "Unknown transform");
});

Deno.test("[StepOutputFormatter.aggregateOutput] single output step returns its content directly", () => {
  const formatter = new StepOutputFormatter();
  const stepResults = new Map([["step-1", makeStepResult("result-content")]]);
  const output: IFlowOutput = { from: "step-1", format: FlowOutputFormat.MARKDOWN };
  assertEquals(formatter.aggregateOutput(output, stepResults), "result-content");
});

Deno.test("[StepOutputFormatter.aggregateOutput] concat format joins with newline, skipping empty", () => {
  const formatter = new StepOutputFormatter();
  const stepResults = new Map([
    ["step-1", makeStepResult("first")],
    ["step-2", makeStepResult("second")],
  ]);
  const output: IFlowOutput = { from: ["step-1", "step-2"], format: FlowOutputFormat.CONCAT };
  assertEquals(formatter.aggregateOutput(output, stepResults), "first\nsecond");
});

Deno.test("[StepOutputFormatter.aggregateOutput] json format returns stepId->content map", () => {
  const formatter = new StepOutputFormatter();
  const stepResults = new Map([
    ["step-1", makeStepResult("first")],
    ["step-2", makeStepResult("second")],
  ]);
  const output: IFlowOutput = { from: ["step-1", "step-2"], format: FlowOutputFormat.JSON };
  assertEquals(
    formatter.aggregateOutput(output, stepResults),
    JSON.stringify({ "step-1": "first", "step-2": "second" }),
  );
});

Deno.test("[StepOutputFormatter.aggregateOutput] markdown format uses ## headers per step", () => {
  const formatter = new StepOutputFormatter();
  const stepResults = new Map([
    ["step-1", makeStepResult("first")],
    ["step-2", makeStepResult("second")],
  ]);
  const output: IFlowOutput = { from: ["step-1", "step-2"], format: FlowOutputFormat.MARKDOWN };
  assertEquals(formatter.aggregateOutput(output, stepResults), "## step-1\n\nfirst\n\n## step-2\n\nsecond");
});

Deno.test("[StepOutputFormatter.aggregateOutput] empty from list returns empty string", () => {
  const formatter = new StepOutputFormatter();
  const output: IFlowOutput = { from: [], format: FlowOutputFormat.MARKDOWN };
  assertEquals(formatter.aggregateOutput(output, new Map()), "");
});

// mergeAsContext on a step's real output: an agent step emits a plan JSON OBJECT, which
// applyMergeAsContextTransform used to reject as "requires an array of strings" while
// unparseable prose fell through fine to the paragraph-splitting fallback.

Deno.test("[StepOutputFormatter.applyTransform] mergeAsContext accepts a JSON object from a prior step", () => {
  const formatter = new StepOutputFormatter();
  const priorStepOutput = JSON.stringify({ description: "Design the API", steps: [{ step: 1, title: "Model" }] });

  const result = formatter.applyTransform(priorStepOutput, "mergeAsContext");

  assertStringIncludes(result, "Design the API");
});

Deno.test("[StepOutputFormatter.applyTransform] mergeAsContext still handles prose and JSON arrays", () => {
  const formatter = new StepOutputFormatter();

  assertStringIncludes(formatter.applyTransform("First para\n\nSecond para", "mergeAsContext"), "First para");
  assertStringIncludes(formatter.applyTransform(JSON.stringify(["alpha", "beta"]), "mergeAsContext"), "alpha");
});

Deno.test("[StepOutputFormatter.applyTransform] mergeAsContext tolerates an empty step output", () => {
  const formatter = new StepOutputFormatter();
  // A step that produced nothing must not take the whole flow down with an exception.
  assertEquals(typeof formatter.applyTransform("", "mergeAsContext"), "string");
});
