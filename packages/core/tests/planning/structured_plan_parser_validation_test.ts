/**
 * @module StructuredPlanParserValidationTest
 * @path packages/core/tests/planning/structured_plan_parser_validation_test.ts
 * @description Boundary regression: the regex-parsed plan body is validated with Zod before
 *   a structured plan is handed to execution. A malformed step (non-positive number) rejects
 *   the whole body, while a well-formed body still parses.
 */
import { assertEquals } from "@std/assert";
import { parseStructuredPlanFromMarkdown } from "@exaix/core/planning";

const FRONTMATTER = { trace_id: "t-1", request_id: "r-1" };

Deno.test("security: structured_plan_parser rejects a malformed body step", () => {
  const content = "# Plan\n\n## Execution Steps\n\n## Step 0: Zero is not a valid step number\n\nbody\n";
  const plan = parseStructuredPlanFromMarkdown(content, FRONTMATTER);
  assertEquals(plan, null);
});

Deno.test("security: structured_plan_parser accepts a well-formed body step", () => {
  const content = "# Plan\n\n## Execution Steps\n\n## Step 1: Do a thing\n\nbody\n";
  const plan = parseStructuredPlanFromMarkdown(content, FRONTMATTER);
  assertEquals(plan?.steps.length, 1);
  assertEquals(plan?.steps[0].number, 1);
});
