/**
 * @module PlanAdapterActionRenderingTest
 * @path packages/core/tests/planning/plan_adapter_action_rendering_test.ts
 * @description Checks that rendered actions preserve exact string parameters.
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_adapter.ts]
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { PlanSchema } from "@exaix/schemas/plan_schema.ts";
import { PlanAdapter } from "../../src/planning/plan_adapter.ts";

Deno.test("rendered patch actions round-trip backslashes, quotes, and multiline text", () => {
  const actions = [{
    tool: "patch_file",
    description: 'Preserve "quoted" source and \\ escapes',
    params: {
      path: "count.sh",
      search: '  printf \'%s\\n%s\\n\' "$line" "$line"',
      replace: "  printf '%s\\n' \"$line\"",
    },
  }, {
    tool: "patch_file",
    params: { path: "example.txt", search: "first\n'''\nlast", replace: "first\nlast\n" },
  }, {
    tool: "patch_file",
    params: { path: "readable.txt", search: "line one\nline two\n", replace: "updated\n" },
  }, {
    tool: "patch_file",
    params: { path: "edge.txt", search: "line one\nends'", replace: "line one\r\nline two\u0001" },
  }];
  const plan = PlanSchema.parse({
    title: "Patch",
    description: "Preserve source text.",
    steps: [{ step: 1, title: "Patch", description: "Apply it.", actions }],
  });
  const markdown = new PlanAdapter().toMarkdown(plan);
  const blocks = [...markdown.matchAll(/```toml\s*\n([\s\S]*?)\n```/g)];
  assertEquals(blocks.length, actions.length);
  assertEquals(blocks.map((block) => parseToml(block[1])), actions);
  assertStringIncludes(markdown, "line one\nline two\n'''");
});
