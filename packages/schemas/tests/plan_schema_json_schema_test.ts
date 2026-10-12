/**
 * @module PlanSchemaJsonSchemaTest
 * @path packages/schemas/tests/plan_schema_json_schema_test.ts
 * @description Phase 151 Step 4 — verifies getPlanJsonSchema() returns a valid
 * JSON Schema object derived from PlanSchema with no hand-duplicated field list.
 */
import type { JSONValue } from "@exaix/core";
import { assertEquals, assertThrows } from "@std/assert";
import { getPlanJsonSchema, PlanSchema } from "../src/plan_schema.ts";
import { validateStructuredOutput } from "@exaix/ai";

Deno.test("fix(plan-schema): structured plan validation preserves JSON values in tool parameters", () => {
  const params: Record<string, JSONValue> = {
    case_sensitive: false,
    limit: 2,
    nullable: null,
    nested: { enabled: true },
    values: ["marker", 1, false, null],
  };
  const plan = {
    description: "Inspect the seeded files",
    steps: [{ step: 1, title: "Read", description: "Read a file", actions: [{ tool: "read_file", params }] }],
  };
  assertEquals(PlanSchema.safeParse(plan).success, true);
  const validated = validateStructuredOutput(JSON.stringify(plan), getPlanJsonSchema(), "openai");
  assertEquals(validated, plan);
  assertThrows(() =>
    validateStructuredOutput(JSON.stringify({ ...plan, description: false }), getPlanJsonSchema(), "openai")
  );
});

Deno.test("getPlanJsonSchema returns an object with type: object", () => {
  const schema = getPlanJsonSchema();
  assertEquals(typeof schema, "object");
  assertEquals(schema.type, "object");
});

Deno.test("getPlanJsonSchema has a properties.steps entry", () => {
  const schema = getPlanJsonSchema();
  const props = schema.properties as Record<string, JSONValue>;
  assertEquals(props !== undefined, true);
  assertEquals((props.steps as Record<string, JSONValue>) !== undefined, true);
});
