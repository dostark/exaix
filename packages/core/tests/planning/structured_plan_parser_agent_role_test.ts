/**
 * @module StructuredPlanParserAgentRoleFallbackTest
 * @path packages/core/tests/planning/structured_plan_parser_agent_role_test.ts
 * @description Regression for the flow→execution agent-role hand-off: a structured plan
 *   whose frontmatter carries no agent_role must parse with a real default agent
 *   (DEFAULT_AGENT_ROLE) rather than the literal "unknown" that previously made plan
 *   execution fail with BLUEPRINT_NOT_FOUND (flow-produced plans carry no agent_role).
 */
import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { DEFAULT_AGENT_ROLE } from "@exaix/core";
import { parseStructuredPlanFromMarkdown } from "@exaix/core/planning";

const FIXTURE_ROOT = join(dirname(fromFileUrl(import.meta.url)), "fixtures");
const FLOW_PLAN = await Deno.readTextFile(join(FIXTURE_ROOT, "flow-step-plan-no-agent-role.md"));

Deno.test("structured plan without agent_role falls back to DEFAULT_AGENT_ROLE, not 'unknown'", () => {
  const plan = parseStructuredPlanFromMarkdown(FLOW_PLAN, { trace_id: "t-1", request_id: "r-1" });
  assertEquals(plan?.agent, DEFAULT_AGENT_ROLE);
  assertEquals(plan?.steps.length, 2);
});

Deno.test("structured plan with agent_role keeps the declared agent role", () => {
  const plan = parseStructuredPlanFromMarkdown(FLOW_PLAN, {
    trace_id: "t-1",
    request_id: "r-1",
    agent_role: "senior-coder",
  });
  assertEquals(plan?.agent, "senior-coder");
});

Deno.test("non-structured content returns null regardless of agent role", () => {
  const plan = parseStructuredPlanFromMarkdown("# Just a heading\n\nno steps here", {
    trace_id: "t-1",
    request_id: "r-1",
  });
  assertEquals(plan, null);
});
