/**
 * @module PlanSchemaJsonSchemaTest
 * @path packages/schemas/tests/plan_schema_json_schema_test.ts
 * @description Phase 151 Step 4 — verifies getPlanJsonSchema() returns a valid
 * JSON Schema object derived from PlanSchema with no hand-duplicated field list.
 */
import type { JSONValue } from "@exaix/core";
import { assertEquals } from "@std/assert";
import { getPlanJsonSchema } from "../src/plan_schema.ts";

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
