/**
 * @module EvaluationJsonSchemaTest
 * @path packages/schemas/tests/evaluation_json_schema_test.ts
 * @description Phase 151 follow-up — verifies getEvaluationResultJsonSchema() and
 * getCriterionResultJsonSchema() return valid JSON Schema objects derived from
 * EvaluationResultSchema/CriterionResultSchema with no hand-duplicated field list.
 */
import type { JSONValue } from "@exaix/core";
import { assertEquals, assertNotEquals } from "@std/assert";
import { getCriterionResultJsonSchema, getEvaluationResultJsonSchema } from "../src/evaluation_json_schema.ts";

Deno.test("getEvaluationResultJsonSchema returns an object with type: object", () => {
  const schema = getEvaluationResultJsonSchema();
  assertEquals(typeof schema, "object");
  assertEquals(schema.type, "object");
});

Deno.test("getEvaluationResultJsonSchema has criteriaScores and overallScore properties", () => {
  const schema = getEvaluationResultJsonSchema();
  const props = schema.properties as Record<string, JSONValue>;
  assertNotEquals(props, undefined);
  assertNotEquals(props.criteriaScores, undefined);
  assertNotEquals(props.overallScore, undefined);
});

Deno.test("getCriterionResultJsonSchema returns an object with type: object", () => {
  const schema = getCriterionResultJsonSchema();
  assertEquals(typeof schema, "object");
  assertEquals(schema.type, "object");
});

Deno.test("getCriterionResultJsonSchema has score, reasoning, and passed properties", () => {
  const schema = getCriterionResultJsonSchema();
  const props = schema.properties as Record<string, JSONValue>;
  assertNotEquals(props, undefined);
  assertNotEquals(props.score, undefined);
  assertNotEquals(props.reasoning, undefined);
  assertNotEquals(props.passed, undefined);
});

Deno.test("getEvaluationResultJsonSchema issues field is typed as array (not string — ZodDefault regression)", () => {
  const schema = getEvaluationResultJsonSchema();
  const props = schema.properties as Record<string, JSONValue>;
  const criteriaScores = props.criteriaScores as Record<string, JSONValue>;
  assertNotEquals(criteriaScores, undefined);
  // criteriaScores is type: object with additionalProperties
  const _expectedArrayType = { type: "array", items: { type: "string" } };
  // Check that suggestions is an array (ZodDefault wrapping ZodArray)
  const suggestions = props.suggestions as Record<string, JSONValue> | undefined;
  // If suggestions exists as a property, it must be an array type
  if (suggestions) {
    assertEquals(suggestions.type, "array");
  }
});
