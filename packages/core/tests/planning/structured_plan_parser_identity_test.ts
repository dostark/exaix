/**
 * @module StructuredPlanParserIdentityFallbackTest
 * @path packages/core/tests/planning/structured_plan_parser_identity_test.ts
 * @description Regression for the flow→execution identity hand-off: a structured plan
 *   whose frontmatter carries no identity_id must parse with a real default agent
 *   (DEFAULT_IDENTITY_ID) rather than the literal "unknown" that previously made plan
 *   execution fail with BLUEPRINT_NOT_FOUND (flow-produced plans carry no identity_id).
 */
import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { DEFAULT_IDENTITY_ID } from "@exaix/core";
import { parseStructuredPlanFromMarkdown } from "@exaix/core/planning";

const FIXTURE_ROOT = join(dirname(fromFileUrl(import.meta.url)), "fixtures");
const FLOW_PLAN = await Deno.readTextFile(join(FIXTURE_ROOT, "flow-step-plan-no-identity.md"));

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
