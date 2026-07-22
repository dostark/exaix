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

/**
 * Convert a Zod schema to a JSON Schema object by walking its _def tree.
 * Only handles the schema shapes used in this codebase (ZodObject, ZodArray,
 * ZodString, ZodNumber, ZodBoolean, ZodNativeEnum, ZodOptional, ZodDefault,
 * ZodEffects, ZodUnion, ZodRecord).
 */
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
  if (schema instanceof z.ZodEffects) {
    return walkSchema(schema._def.schema as z.ZodTypeAny);
  }

  if (schema instanceof z.ZodOptional) {
    return walkSchema((schema as z.ZodOptional<z.ZodTypeAny>).unwrap());
  }

  if (schema instanceof z.ZodDefault) {
    return walkSchema((schema as z.ZodDefault<z.ZodTypeAny>)._def.innerType);
  }

  if (schema instanceof z.ZodObject) {
    return walkObject(schema);
  }

  if (schema instanceof z.ZodArray) {
    return { type: "array", items: walkSchema(schema.element) };
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

  if (schema instanceof z.ZodNativeEnum) {
    const values = Object.values(schema.enum).filter((v): v is string => typeof v === "string");
    return { type: "string", enum: values };
  }

  if (schema instanceof z.ZodUnion) {
    const options = (schema._def as { options?: z.ZodTypeAny[] }).options || [];
    return { anyOf: options.map((o) => walkSchema(o)) };
  }

  if (schema instanceof z.ZodRecord) {
    const valueSchema = (schema._def as { valueType?: z.ZodTypeAny }).valueType;
    return { type: "object", additionalProperties: valueSchema ? walkSchema(valueSchema) : true };
  }

  return { type: "string" };
}
