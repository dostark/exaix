/**
 * @module XmlPlanParserTest
 * @path packages/core/tests/planning/xml_plan_parser_test.ts
 * @description Tests for xml_plan_parser.ts — converts XML plan format to PlanSchema-compatible
 *   JSON objects. XML format is a model-friendly alternative to pure JSON for LLMs that struggle
 *   with JSON generation (e.g. deepseek-v4-flash through opencode CLI).
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/xml_plan_parser.ts, packages/core/src/planning/plan_adapter.ts]
 */

import { assertEquals } from "@std/assert";
import {
  type IXmlPlanParseError,
  type IXmlPlanParseResult,
  type IXmlPlanParseSuccess,
  tryParseXmlPlan,
} from "../../src/planning/xml_plan_parser.ts";
import { PlanSchema } from "@exaix/schemas/plan_schema.ts";

interface IPlanWithSteps {
  title?: string;
  description: string;
  steps?: IStepWithActions[];
  estimatedDuration?: string;
}

interface IStepWithActions {
  step: number;
  title: string;
  description: string;
  actions?: IActionItem[];
  successCriteria?: string[];
}

interface IActionParams {
  [key: string]: string | number | undefined;
}

interface IActionItem {
  tool: string;
  description?: string;
  params?: IActionParams;
}

function assertPlanSuccess(result: IXmlPlanParseResult): asserts result is IXmlPlanParseSuccess {
  assertEquals(result.success, true);
}

function planWithSteps(result: IXmlPlanParseResult): IPlanWithSteps {
  assertPlanSuccess(result);
  return result.plan as IPlanWithSteps;
}

const SIMPLE_PLAN_XML = `<plan>
  <title>Fix null safety bug</title>
  <description>Add null guard to formatDueDate and formatAssignee</description>
  <step number="1">
    <title>Read source file</title>
    <description>Examine utils.ts to understand current implementation</description>
    <tool>read_file</tool>
    <params>
      <path>src/utils.ts</path>
    </params>
  </step>
  <step number="2">
    <title>Apply fix</title>
    <description>Add null check before accessing properties</description>
    <tool>patch_file</tool>
    <params>
      <path>src/utils.ts</path>
      <search>function formatDueDate(task: ITask): string {
  return task.dueDate.slice(0, 10);
}</search>
      <replace>function formatDueDate(task: ITask): string {
  return task.dueDate ? task.dueDate.slice(0, 10) : "";
}</replace>
    </params>
  </step>
</plan>`;

Deno.test("[XmlPlanParser] converts a simple plan XML to a PlanSchema-compatible JSON object", () => {
  const plan = planWithSteps(tryParseXmlPlan(SIMPLE_PLAN_XML));
  assertEquals(plan.title, "Fix null safety bug");
  assertEquals(plan.description, "Add null guard to formatDueDate and formatAssignee");
  assertEquals(plan.steps?.length, 2);
  assertEquals(plan.steps?.[0].step, 1);
  assertEquals(plan.steps?.[0].title, "Read source file");
  assertEquals(plan.steps?.[0].actions?.length, 1);
  assertEquals(plan.steps?.[0].actions?.[0].tool, "read_file");
  assertEquals(plan.steps?.[0].actions?.[0]?.params?.path, "src/utils.ts");
  assertEquals(plan.steps?.[1].step, 2);
  assertEquals(plan.steps?.[1].title, "Apply fix");
  assertEquals(plan.steps?.[1].actions?.[0].tool, "patch_file");
});

Deno.test("[XmlPlanParser] result validates against PlanSchema", () => {
  const result = tryParseXmlPlan(SIMPLE_PLAN_XML);
  assertEquals(result.success, true);
  if (!result.success) return;
  const validated = PlanSchema.safeParse(result.plan);
  assertEquals(validated.success, true);
});

const MULTI_ACTION_STEP_XML = `<plan>
  <title>Multi-action step</title>
  <description>Step with two tools</description>
  <step number="1">
    <title>Read and write</title>
    <description>Read file then make changes</description>
    <tool>read_file</tool>
    <params>
      <path>src/data.ts</path>
    </params>
    <tool>write_file</tool>
    <params>
      <path>src/data.ts</path>
      <content>export const data = { key: "value" };</content>
    </params>
  </step>
</plan>`;

Deno.test("[XmlPlanParser] multiple tool entries in one step produce multiple actions", () => {
  const plan = planWithSteps(tryParseXmlPlan(MULTI_ACTION_STEP_XML));
  assertEquals(plan.steps?.length, 1);
  assertEquals(plan.steps?.[0].actions?.length, 2);
  assertEquals(plan.steps?.[0].actions?.[0].tool, "read_file");
  assertEquals(plan.steps?.[0].actions?.[1].tool, "write_file");
  assertEquals(plan.steps?.[0].actions?.[1]?.params?.content, 'export const data = { key: "value" };');
});

const WITH_SUCCESS_CRITERIA_XML = `<plan>
  <title>Add tests</title>
  <description>Write unit tests for the new feature</description>
  <step number="1">
    <title>Create test file</title>
    <description>Write the test cases</description>
    <tool>write_file</tool>
    <params>
      <path>src/feature_test.ts</path>
    </params>
    <successCriteria>
      <item>All tests pass</item>
      <item>Coverage is above 80%</item>
    </successCriteria>
  </step>
</plan>`;

Deno.test("[XmlPlanParser] successCriteria items are parsed into an array", () => {
  const plan = planWithSteps(tryParseXmlPlan(WITH_SUCCESS_CRITERIA_XML));
  assertEquals(plan.steps?.[0].successCriteria?.length, 2);
  assertEquals(plan.steps?.[0].successCriteria?.[0], "All tests pass");
  assertEquals(plan.steps?.[0].successCriteria?.[1], "Coverage is above 80%");
});

const PLAIN_TEXT_INPUT = "This is not XML, just plain text that a model might output.";

Deno.test("[XmlPlanParser] non-XML input returns success=false with clear error", () => {
  const result = tryParseXmlPlan(PLAIN_TEXT_INPUT);
  assertEquals(result.success, false);
  assertEquals(typeof (result as IXmlPlanParseError).error, "string");
});

const EMPTY_INPUT = "";

Deno.test("[XmlPlanParser] empty input returns success=false", () => {
  const result = tryParseXmlPlan(EMPTY_INPUT);
  assertEquals(result.success, false);
});

const MISSING_TITLE_XML = `<plan>
  <description>Plan without a title</description>
  <step number="1">
    <title>Do something</title>
    <tool>read_file</tool>
    <params>
      <path>src/file.ts</path>
    </params>
  </step>
</plan>`;

Deno.test("[XmlPlanParser] missing title does not fail (title is optional in PlanSchema)", () => {
  const plan = planWithSteps(tryParseXmlPlan(MISSING_TITLE_XML));
  assertEquals(plan.description, "Plan without a title");
  const result = tryParseXmlPlan(MISSING_TITLE_XML);
  assertEquals(result.success, true);
  if (!result.success) return;
  const validated = PlanSchema.safeParse(result.plan);
  assertEquals(validated.success, true);
});

const STEP_WITHOUT_NUMBER_XML = `<plan>
  <title>Step without number</title>
  <description>A step that forgot its number attribute</description>
  <step>
    <title>Do work</title>
    <tool>read_file</tool>
    <params>
      <path>src/file.ts</path>
    </params>
  </step>
</plan>`;

Deno.test("[XmlPlanParser] step without number attribute defaults to sequential index", () => {
  const plan = planWithSteps(tryParseXmlPlan(STEP_WITHOUT_NUMBER_XML));
  assertEquals(plan.steps?.[0].step, 1);
});

const XML_WITH_TOOL_DESCRIPTION = `<plan>
  <title>Test</title>
  <description>A plan with tool descriptions</description>
  <step number="1">
    <title>Step one</title>
    <description>Description of the step</description>
    <tool>read_file</tool>
    <actionDescription>Read the configuration file</actionDescription>
    <params>
      <path>src/config.ts</path>
    </params>
  </step>
</plan>`;

Deno.test("[XmlPlanParser] actionDescription maps to action.description field", () => {
  const plan = planWithSteps(tryParseXmlPlan(XML_WITH_TOOL_DESCRIPTION));
  assertEquals(plan.steps?.[0].actions?.[0].description, "Read the configuration file");
});

const XML_WITH_ESTIMATED_DURATION = `<plan>
  <title>Estimated plan</title>
  <description>Plan with estimated duration</description>
  <estimatedDuration>2 hours</estimatedDuration>
  <step number="1">
    <title>Do work</title>
    <tool>read_file</tool>
    <params>
      <path>src/file.ts</path>
    </params>
  </step>
</plan>`;

Deno.test("[XmlPlanParser] estimatedDuration is parsed from plan-level element", () => {
  const plan = planWithSteps(tryParseXmlPlan(XML_WITH_ESTIMATED_DURATION));
  assertEquals(plan.estimatedDuration, "2 hours");
});
