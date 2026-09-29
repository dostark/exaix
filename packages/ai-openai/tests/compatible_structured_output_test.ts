/**
 * @module CompatibleStructuredOutputTest
 * @path packages/ai-openai/tests/compatible_structured_output_test.ts
 * @description Exercises the supported JSON-Schema subset check, OpenAI strict-mode
 *   normalization round trip, and DeepSeek json-mode dispatch against the real plan schema.
 * @architectural-layer Tests
 * @dependencies [@exaix/ai-openai, @exaix/schemas]
 * @related-files [packages/ai-openai/src/compatible_structured_output.ts]
 */
import { assertEquals, assertThrows } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import { getPlanJsonSchema } from "@exaix/schemas/plan_schema.ts";
import { PlanAdapter } from "@exaix/core/planning";
import {
  assertSupportedJsonSchema,
  isStrictRepresentable,
  planStructuredOutput,
  stripIntroducedNulls,
  toStrictSchema,
  UnsupportedJsonSchemaError,
  validateStructuredOutput,
} from "../src/compatible_structured_output.ts";
import { STRUCTURED_OUTPUT_JSON_MODE_INSTRUCTION } from "../src/constants.ts";

const schema = (body: Record<string, JSONValue>): Record<string, JSONValue> => body;

Deno.test("assertSupportedJsonSchema accepts every supported keyword", () => {
  assertSupportedJsonSchema(schema({
    type: "object",
    title: "T",
    description: "d",
    properties: {
      a: { type: "string", minLength: 1, maxLength: 10 },
      b: { type: "number", minimum: 0, maximum: 5 },
      c: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 3 },
      d: { anyOf: [{ type: "string" }, { type: "null" }] },
      e: { enum: ["x", "y"] },
      f: { const: "z" },
      g: { $ref: "#/$defs/Node" },
    },
    required: ["a"],
    additionalProperties: false,
    $defs: { Node: { type: "object", properties: { n: { type: "string" } }, additionalProperties: false } },
  }));
});

Deno.test("assertSupportedJsonSchema rejects an unsupported keyword (pattern)", () => {
  assertThrows(
    () => assertSupportedJsonSchema(schema({ type: "string", pattern: "^a" })),
    UnsupportedJsonSchemaError,
  );
});

Deno.test("assertSupportedJsonSchema rejects oneOf/allOf/patternProperties", () => {
  assertThrows(() => assertSupportedJsonSchema(schema({ oneOf: [{ type: "string" }] })), UnsupportedJsonSchemaError);
  assertThrows(() => assertSupportedJsonSchema(schema({ allOf: [{ type: "string" }] })), UnsupportedJsonSchemaError);
  assertThrows(
    () => assertSupportedJsonSchema(schema({ type: "object", patternProperties: { "^x": { type: "string" } } })),
    UnsupportedJsonSchemaError,
  );
});

Deno.test("assertSupportedJsonSchema rejects a remote $ref", () => {
  assertThrows(
    () => assertSupportedJsonSchema(schema({ $ref: "https://example.com/schema.json" })),
    UnsupportedJsonSchemaError,
  );
});

Deno.test("assertSupportedJsonSchema rejects a $ref cycle", () => {
  assertThrows(
    () =>
      assertSupportedJsonSchema(schema({
        type: "object",
        properties: { self: { $ref: "#/$defs/A" } },
        $defs: { A: { type: "object", properties: { next: { $ref: "#/$defs/A" } } } },
      })),
    UnsupportedJsonSchemaError,
  );
});

Deno.test("assertSupportedJsonSchema rejects a schema over the byte cap", () => {
  const big = { type: "string", description: "x".repeat(70 * 1024) };
  assertThrows(() => assertSupportedJsonSchema(schema(big)), UnsupportedJsonSchemaError);
});

Deno.test("assertSupportedJsonSchema rejects nesting past the cap", () => {
  let node: Record<string, JSONValue> = { type: "string" };
  for (let i = 0; i < 70; i++) node = { type: "object", properties: { n: node } };
  assertThrows(() => assertSupportedJsonSchema(node), UnsupportedJsonSchemaError);
});

Deno.test("isStrictRepresentable is false for a schema-valued additionalProperties (a record)", () => {
  assertEquals(
    isStrictRepresentable(schema({
      type: "object",
      properties: { params: { type: "object", additionalProperties: { type: "string" } } },
      required: ["params"],
    })),
    false,
  );
});

Deno.test("isStrictRepresentable is true when every object closes with a boolean additionalProperties", () => {
  assertEquals(
    isStrictRepresentable(schema({
      type: "object",
      properties: { a: { type: "object", properties: { n: { type: "string" } }, additionalProperties: false } },
      additionalProperties: false,
    })),
    true,
  );
});

Deno.test("the real plan schema is not strict-representable (params is a record)", () => {
  assertEquals(isStrictRepresentable(getPlanJsonSchema()), false);
});

Deno.test("toStrictSchema closes every object and makes optional properties required+nullable", () => {
  const strict = toStrictSchema(schema({
    type: "object",
    properties: { a: { type: "string" }, b: { type: "number" } },
    required: ["a"],
  })) as Record<string, JSONValue>;
  assertEquals(strict.additionalProperties, false);
  assertEquals(strict.required, ["a", "b"]);
  const properties = strict.properties as Record<string, JSONValue>;
  assertEquals(properties.a, { type: "string" });
  assertEquals(properties.b, { anyOf: [{ type: "number" }, { type: "null" }] });
});

Deno.test("stripIntroducedNulls removes a null only for a property that was optional and disallowed null originally", () => {
  const original = schema({
    type: "object",
    properties: {
      a: { type: "string" },
      b: { type: "number" },
      c: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["a", "c"],
  });
  const stripped = stripIntroducedNulls({ a: "x", b: null, c: null }, original) as Record<string, JSONValue>;
  assertEquals("b" in stripped, false, "b was optional and never allowed null — strip it");
  assertEquals(stripped.c, null, "c was required and allows null in the original schema — keep it");
  assertEquals(stripped.a, "x");
});

Deno.test("stripIntroducedNulls recurses into nested objects and arrays", () => {
  const original = schema({
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { title: { type: "string" }, note: { type: "string" } },
          required: ["title"],
        },
      },
    },
    required: ["items"],
  });
  const stripped = stripIntroducedNulls(
    { items: [{ title: "t", note: null }] },
    original,
  ) as { items: Record<string, JSONValue>[] };
  assertEquals("note" in stripped.items[0], false);
});

Deno.test("strict output removes introduced nulls inside local refs and matching anyOf branches", () => {
  const original = schema({
    type: "object",
    properties: {
      child: { $ref: "#/$defs/Child" },
      choice: {
        anyOf: [
          {
            type: "object",
            properties: { kind: { const: "a" }, note: { type: "string" } },
            required: ["kind"],
          },
          {
            type: "object",
            properties: { kind: { const: "b" }, count: { type: "number" } },
            required: ["kind"],
          },
        ],
      },
    },
    required: ["child", "choice"],
    $defs: {
      Child: {
        type: "object",
        properties: { title: { type: "string" }, optional: { type: "string" } },
        required: ["title"],
      },
    },
  });
  const response = { child: { title: "t", optional: null }, choice: { kind: "a", note: null } };
  assertEquals(planStructuredOutput("openai", original).mode, "json_schema");
  assertEquals(validateStructuredOutput(JSON.stringify(response), original, "openai"), {
    child: { title: "t" },
    choice: { kind: "a" },
  });
});

Deno.test("strict output preserves legal nulls in enum, const, union type, ref and anyOf", () => {
  const original = schema({
    type: "object",
    properties: {
      enumValue: { enum: ["x", null] },
      constValue: { const: null },
      unionValue: { type: ["string", "null"] },
      nested: { $ref: "#/$defs/Nullable" },
      choice: { anyOf: [{ type: "null" }, { type: "string" }] },
    },
    $defs: { Nullable: { type: "object", properties: { value: { enum: ["y", null] } } } },
  });
  const response = {
    enumValue: null,
    constValue: null,
    unionValue: null,
    nested: { value: null },
    choice: null,
  };
  assertEquals(validateStructuredOutput(JSON.stringify(response), original, "openai"), response);
});

Deno.test("planStructuredOutput picks OpenAI strict json_schema mode for a strict-representable schema", () => {
  const plan = planStructuredOutput(
    "openai",
    schema({
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    }),
  );
  assertEquals(plan.mode, "json_schema");
  assertEquals(plan.reason, undefined);
  assertEquals(plan.responseFormat.type, "json_schema");
});

Deno.test("planStructuredOutput falls back to json_object for OpenAI on a non-strict-representable schema", () => {
  const plan = planStructuredOutput("openai", getPlanJsonSchema());
  assertEquals(plan.mode, "json_object");
  assertEquals(plan.reason, "schema_not_strict_representable");
  assertEquals(plan.responseFormat.type, "json_object");
  assertEquals(typeof plan.promptInstruction === "string" && plan.promptInstruction.includes("json"), true);
});

Deno.test("planStructuredOutput picks strict json_schema mode for the local-test profile too", () => {
  const plan = planStructuredOutput(
    "local-test",
    schema({
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    }),
  );
  assertEquals(plan.mode, "json_schema");
  assertEquals(plan.reason, undefined);
});

Deno.test("planStructuredOutput always uses json_object mode for DeepSeek, even on a strict-representable schema", () => {
  const plan = planStructuredOutput(
    "deepseek",
    schema({
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    }),
  );
  assertEquals(plan.mode, "json_object");
  assertEquals(plan.reason, undefined);
  assertEquals(plan.responseFormat.type, "json_object");
});

Deno.test("json_object instruction overrides prompt-level wrapper tags so the reply is bare JSON", () => {
  assertEquals(STRUCTURED_OUTPUT_JSON_MODE_INSTRUCTION.includes("<content>"), true);
  assertEquals(STRUCTURED_OUTPUT_JSON_MODE_INSTRUCTION.includes("first character"), true);
});

Deno.test("validateStructuredOutput accepts a valid real plan through both profiles", () => {
  const validPlan = { title: "T", description: "d", steps: [{ step: 1, title: "s", description: "d" }] };
  for (const profile of ["openai", "deepseek"] as const) {
    const result = validateStructuredOutput(JSON.stringify(validPlan), getPlanJsonSchema(), profile);
    assertEquals((result as Record<string, JSONValue>).title, "T");
  }
});

Deno.test("validateStructuredOutput rejects a plan whose action params value is non-string, through both profiles", () => {
  const badPlan = {
    title: "T",
    description: "d",
    steps: [{
      step: 1,
      title: "s",
      description: "d",
      actions: [{ tool: "x", params: { count: 5 } }],
    }],
  };
  for (const profile of ["openai", "deepseek"] as const) {
    assertThrows(() => validateStructuredOutput(JSON.stringify(badPlan), getPlanJsonSchema(), profile));
  }
});

Deno.test("validateStructuredOutput rejects malformed JSON", () => {
  assertThrows(() => validateStructuredOutput("{not json", getPlanJsonSchema(), "openai"));
});

Deno.test("a validateStructuredOutput result parses through the real PlanAdapter into an accepted Plan", () => {
  const validPlan = {
    title: "T",
    description: "d",
    steps: [{
      step: 1,
      title: "s",
      description: "d",
      actions: [{ tool: "read_file", params: { path: "a.ts" } }],
    }],
  };
  const normalized = validateStructuredOutput(JSON.stringify(validPlan), getPlanJsonSchema(), "openai");
  const plan = new PlanAdapter().parse(JSON.stringify(normalized));
  assertEquals(plan.title, "T");
  assertEquals(plan.steps?.[0].actions?.[0].tool, "read_file");
});
