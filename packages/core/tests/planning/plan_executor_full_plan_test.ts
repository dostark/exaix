/**
 * @module PlanExecutorFullPlanTest
 * @path packages/core/tests/planning/plan_executor_full_plan_test.ts
 * @description Verifies buildFullPlanText concatenates every plan step's title and
 *   content into one document, passed as IExecutionContext.full_plan alongside each
 *   step's own fragment — CliDelegateStrategy uses it on a trace's first turn so a
 *   headless CLI session orients on the whole task instead of one isolated,
 *   ReAct-shaped step fragment (e.g. "Tools: read_file").
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/strategies/cli_delegate_strategy.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildFullPlanText, type IPlanStep } from "../../src/planning/mod.ts";

Deno.test("buildFullPlanText: concatenates a single step's title and content", () => {
  const steps: IPlanStep[] = [
    { number: 1, title: "Inspect current implementation", content: "Read src/utils.ts to see the bug." },
  ];

  const text = buildFullPlanText(steps);

  assertStringIncludes(text, "Inspect current implementation");
  assertStringIncludes(text, "Read src/utils.ts to see the bug.");
});

Deno.test("buildFullPlanText: joins multiple steps in order with a separator", () => {
  const steps: IPlanStep[] = [
    { number: 1, title: "Step one", content: "Do the first thing." },
    { number: 2, title: "Step two", content: "Do the second thing." },
    { number: 3, title: "Step three", content: "Do the third thing." },
  ];

  const text = buildFullPlanText(steps);

  const indexOne = text.indexOf("Step one");
  const indexTwo = text.indexOf("Step two");
  const indexThree = text.indexOf("Step three");
  assertEquals(indexOne >= 0 && indexTwo > indexOne && indexThree > indexTwo, true);
  assertStringIncludes(text, "Do the first thing.");
  assertStringIncludes(text, "Do the second thing.");
  assertStringIncludes(text, "Do the third thing.");
});

Deno.test("buildFullPlanText: empty steps array yields an empty string", () => {
  assertEquals(buildFullPlanText([]), "");
});
