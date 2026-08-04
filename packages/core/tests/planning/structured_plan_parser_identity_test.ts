/**
 * @module StructuredPlanParserIdentityFallbackTest
 * @path packages/core/tests/planning/structured_plan_parser_identity_test.ts
 * @description Regression for the flow→execution identity hand-off: a structured plan
 *   whose frontmatter carries no identity_id must parse with a real default agent
 *   (DEFAULT_IDENTITY_ID) rather than the literal "unknown" that previously made plan
 *   execution fail with BLUEPRINT_NOT_FOUND (flow-produced plans carry no identity_id).
 */
import { assertEquals } from "@std/assert";
import { DEFAULT_IDENTITY_ID } from "@exaix/core";
import { parseStructuredPlanFromMarkdown } from "@exaix/core/planning";

const FLOW_PLAN = `---
trace_id: "t-1"
request_id: "r-1"
status: pending
---

# Flow Step Output

Structured output for this step

## Execution Steps

## Step 1: Implement handleCompleteTask

Add the complete-task handler to src/api.ts.

## Step 2: Verify

Run the test suite.
`;

Deno.test("structured plan without identity_id falls back to DEFAULT_IDENTITY_ID, not 'unknown'", () => {
  const plan = parseStructuredPlanFromMarkdown(FLOW_PLAN, { trace_id: "t-1", request_id: "r-1" });
  assertEquals(plan?.agent, DEFAULT_IDENTITY_ID);
  assertEquals(plan?.steps.length, 2);
});

Deno.test("structured plan with identity_id keeps the declared identity", () => {
  const plan = parseStructuredPlanFromMarkdown(FLOW_PLAN, {
    trace_id: "t-1",
    request_id: "r-1",
    identity_id: "senior-coder",
  });
  assertEquals(plan?.agent, "senior-coder");
});

Deno.test("non-structured content returns null regardless of identity", () => {
  const plan = parseStructuredPlanFromMarkdown("# Just a heading\n\nno steps here", {
    trace_id: "t-1",
    request_id: "r-1",
  });
  assertEquals(plan, null);
});
