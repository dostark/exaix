/**
 * @module RequestAnalysisJsonSchemaTest
 * @path packages/schemas/tests/request_analysis_json_schema_test.ts
 * @description Phase 151 Step 4 — verifies getRequestAnalysisJsonSchema() returns
 * a valid JSON Schema object derived from RequestAnalysisSchema.
 */
import type { JSONValue } from "@exaix/core";
import { assertEquals, assertFalse } from "@std/assert";
import { getRequestAnalysisCoreJsonSchema, getRequestAnalysisJsonSchema } from "../src/request_analysis.ts";

Deno.test("getRequestAnalysisJsonSchema returns an object with type: object", () => {
  const schema = getRequestAnalysisJsonSchema();
  assertEquals(typeof schema, "object");
  assertEquals(schema.type, "object");
});

Deno.test("getRequestAnalysisJsonSchema has properties with goals and requirements", () => {
  const schema = getRequestAnalysisJsonSchema();
  const props = schema.properties as Record<string, JSONValue>;
  assertEquals(props !== undefined, true);
  assertEquals((props.goals as Record<string, JSONValue>) !== undefined, true);
  assertEquals((props.requirements as Record<string, JSONValue>) !== undefined, true);
});

Deno.test("getRequestAnalysisCoreJsonSchema omits metadata from properties and required", () => {
  const schema = getRequestAnalysisCoreJsonSchema() as {
    properties: Record<string, JSONValue>;
    required?: string[];
  };
  assertEquals("metadata" in schema.properties, false);
  assertFalse((schema.required ?? []).includes("metadata"));
});

Deno.test("getRequestAnalysisCoreJsonSchema keeps every other property of the full schema", () => {
  const full = getRequestAnalysisJsonSchema() as { properties: Record<string, JSONValue> };
  const core = getRequestAnalysisCoreJsonSchema() as { properties: Record<string, JSONValue> };
  const expected = Object.keys(full.properties).filter((name) => name !== "metadata").sort();
  assertEquals(Object.keys(core.properties).sort(), expected);
});
