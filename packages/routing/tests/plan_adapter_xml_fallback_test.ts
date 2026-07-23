/**
 * @module PlanAdapterXmlFallbackTest
 * @path packages/routing/tests/plan_adapter_xml_fallback_test.ts
 * @description Verifies PlanAdapter.parse() handles XML plan format as a fallback — when
 *   content starts with <plan> tag, the XML parser converts it to a PlanSchema-compatible
 *   object. Pure-JSON plans are unaffected.
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_adapter.ts, packages/core/src/planning/xml_plan_parser.ts]
 */

import { assertEquals } from "@std/assert";
import { PlanAdapter, PlanValidationError } from "@exaix/core/planning";

const adapter = new PlanAdapter();

const XML_PLAN = `<plan>
  <title>Add unit tests</title>
  <description>Write comprehensive unit tests for the priority calculator</description>
  <step number="1">
    <title>Read existing tests</title>
    <description>Review the test file for conventions</description>
    <tool>read_file</tool>
    <params>
      <path>src/priority_calculator_test.ts</path>
    </params>
  </step>
  <step number="2">
    <title>Add test cases</title>
    <description>Write tests covering edge cases</description>
    <tool>patch_file</tool>
    <params>
      <path>src/priority_calculator_test.ts</path>
      <search>// existing tests</search>
      <replace>// new test cases</replace>
    </params>
    <successCriteria>
      <item>All tests pass</item>
    </successCriteria>
  </step>
</plan>`;

Deno.test("[PlanAdapter] XML plan is parsed and validates against PlanSchema", () => {
  const plan = adapter.parse(XML_PLAN);
  assertEquals(plan.title, "Add unit tests");
  assertEquals(plan.description, "Write comprehensive unit tests for the priority calculator");
  assertEquals(plan.steps?.length, 2);
  assertEquals(plan.steps?.[0].title, "Read existing tests");
  assertEquals(plan.steps?.[0].actions?.[0].tool, "read_file");
  assertEquals(plan.steps?.[1].actions?.[0].tool, "patch_file");
  assertEquals(plan.steps?.[1].successCriteria?.[0], "All tests pass");
});

const PURE_JSON_PLAN = JSON.stringify({
  title: "Pure JSON plan",
  description: "This plan uses pure JSON without XML",
  steps: [
    {
      step: 1,
      title: "Read file",
      description: "Read the file",
      actions: [{ tool: "read_file", params: { path: "src/file.ts" } }],
    },
  ],
});

Deno.test("[PlanAdapter] pure JSON plans still parse correctly (XML fallback is no-op)", () => {
  const plan = adapter.parse(PURE_JSON_PLAN);
  assertEquals(plan.title, "Pure JSON plan");
  assertEquals(plan.steps?.length, 1);
});

Deno.test("[PlanAdapter] prose text (no XML, no JSON) still throws PlanValidationError", () => {
  const proseInput = "The plan above contains three patch_file operations...";
  try {
    adapter.parse(proseInput);
    throw new Error("Expected PlanValidationError to be thrown");
  } catch (error) {
    assertEquals(error instanceof PlanValidationError, true);
  }
});

const MINIMAL_XML_PLAN = `<plan>
  <description>Minimal plan with no title</description>
  <step number="1">
    <title>Single step</title>
    <tool>read_file</tool>
    <params>
      <path>src/file.ts</path>
    </params>
  </step>
</plan>`;

Deno.test("[PlanAdapter] minimal XML plan (no title) parses and validates", () => {
  const plan = adapter.parse(MINIMAL_XML_PLAN);
  assertEquals(plan.description, "Minimal plan with no title");
  assertEquals(plan.steps?.[0].title, "Single step");
});
