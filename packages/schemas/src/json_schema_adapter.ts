/**
 * @module JsonSchemaAdapter
 * @path packages/schemas/src/json_schema_adapter.ts
 * @description Converts Zod schemas to JSON Schema objects for use with CLI
 * --json-schema flags (e.g. claude-code's --json-schema). Uses the schema's
 * internal _def to walk the shape generically at runtime, avoiding the npm/deno
 * zod type incompatibility that makes zod-to-json-schema's TypeScript types
 * unassignable in this project.
 * @architectural-layer Shared
 * @related-files [packages/schemas/src/plan_schema.ts, packages/schemas/src/request_analysis.ts]
 */
import type { JSONValue } from "@exaix/core";
import { z } from "zod";

/** Only handles the schema shapes used in this codebase (ZodObject, ZodArray, ZodString,
 *  ZodNumber, ZodBoolean, ZodNativeEnum, ZodOptional, ZodDefault, ZodEffects, ZodUnion,
 *  ZodRecord). */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, JSONValue> {
  return walkSchema(schema);
}

function walkObject(schema: z.ZodObject<z.ZodRawShape>): Record<string, JSONValue> {
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const required: string[] = [];
  const properties: Record<string, JSONValue> = {};
  for (const [key, fieldSchema] of Object.entries(shape)) {
    properties[key] = walkSchema(fieldSchema);
    if (!(fieldSchema instanceof z.ZodOptional)) {
      required.push(key);
    }
  }
  const result: Record<string, JSONValue> = { type: "object", properties };
  if (required.length > 0) result.required = required;
  return result;
}

function walkSchema(schema: z.ZodTypeAny): Record<string, JSONValue> {
  if (schema instanceof z.ZodPipe) {
    // .transform()/.pipe() — describe the pre-transform input shape.
    return walkSchema(schema.in as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodOptional) {
    return walkSchema(schema.unwrap() as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodDefault) {
    return walkSchema(schema.unwrap() as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodPrefault) {
    return walkSchema(schema.unwrap() as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodObject) {
    return walkObject(schema);
  }

  if (schema instanceof z.ZodArray) {
    return { type: "array", items: walkSchema(schema.element as z.ZodTypeAny) };
  }

  if (schema instanceof z.ZodString) {
    return { type: "string" };
  }

  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }

  // z.nativeEnum() also constructs a ZodEnum instance in v4 — this covers both z.enum() and
  // the deprecated z.nativeEnum() call sites still used throughout the schemas package.
  if (schema instanceof z.ZodEnum) {
    const values = Object.values(schema.enum).filter((v): v is string => typeof v === "string");
    return { type: "string", enum: values };
  }

  if (schema instanceof z.ZodUnion) {
    return { anyOf: schema.options.map((option) => walkSchema(option as z.ZodTypeAny)) };
  }

  if (schema instanceof z.ZodRecord) {
    return { type: "object", additionalProperties: walkSchema(schema.valueType as z.ZodTypeAny) };
  }

  return { type: "string" };
}
