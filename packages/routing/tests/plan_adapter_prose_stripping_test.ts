/**
 * @module PlanAdapterProseStrippingTest
 * @path packages/routing/tests/plan_adapter_prose_stripping_test.ts
 * @description Tests that PlanAdapter.parse() strips prose before XML/JSON extraction.
 *   LLMs commonly prepend or interleave prose with structured output ("I've added the
 *   handler...", "Based on my analysis:\n<plan>..."). The parser must extract only the
 *   structured span before passing to format-specific parsers.
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_adapter.ts]
 */

import { assertEquals } from "@std/assert";
import { PlanAdapter, PlanValidationError } from "@exaix/core/planning";

const adapter = new PlanAdapter();

const XML_PLAN = `<plan>
  <title>Test plan</title>
  <description>A test plan</description>
  <step number="1">
    <title>Step one</title>
    <tool>read_file</tool>
    <params>
      <path>src/file.ts</path>
    </params>
  </step>
</plan>`;

const JSON_PLAN = JSON.stringify({
  title: "Test plan",
  description: "A test plan",
  steps: [{
    step: 1,
    title: "Step one",
    description: "Step one",
    actions: [{ tool: "read_file", params: { path: "src/file.ts" } }],
  }],
});

Deno.test("[ProseStripping] prose before <plan> tag is stripped", () => {
  const input = `Based on my analysis:\n\n${XML_PLAN}`;
  const plan = adapter.parse(input);
  assertEquals(plan.title, "Test plan");
});

Deno.test("[ProseStripping] prose after </plan> tag is stripped", () => {
  const input = `${XML_PLAN}\n\nThis plan addresses all concerns.`;
  const plan = adapter.parse(input);
  assertEquals(plan.title, "Test plan");
});

Deno.test("[ProseStripping] prose both before and after <plan> is stripped", () => {
  const input = `I've reviewed the code.\n\n${XML_PLAN}\n\nLet me know if changes are needed.`;
  const plan = adapter.parse(input);
  assertEquals(plan.title, "Test plan");
});

Deno.test("[ProseStripping] pure XML with no prose passes through unchanged", () => {
  const plan = adapter.parse(XML_PLAN);
  assertEquals(plan.title, "Test plan");
});

Deno.test("[ProseStripping] prose before { is stripped for JSON path", () => {
  const input = `Here is the plan:\n\n${JSON_PLAN}\n\nHope this helps.`;
  const plan = adapter.parse(input);
  assertEquals(plan.title, "Test plan");
});

Deno.test("[ProseStripping] multiple <plan> blocks: first span is extracted (non-greedy)", () => {
  const input =
    `${XML_PLAN}\n\n<plan><title>Second plan</title><description>Second</description><step number="1"><title>S2</title><tool>read_file</tool><params><path>x</path></params></step></plan>`;
  const plan = adapter.parse(input);
  assertEquals(plan.title, "Test plan");
});

Deno.test("[ProseStripping] prose-only content (no <plan>, no {}) still throws PlanValidationError", () => {
  const input = "I've added the handler and tests. Here are the changes:";
  try {
    adapter.parse(input);
    throw new Error("Expected PlanValidationError");
  } catch (error) {
    assertEquals(error instanceof PlanValidationError, true);
  }
});
