/**
 * @module SchemaDescriber
 * @path packages/schemas/src/schema_describer.ts
 * @description Provides a utility function to generate human-readable descriptions from Zod schemas, aiding LLMs in resolving validation errors.
 * @architectural-layer Schemas
 * @ungrounded
 * @related-files ["packages/request/src/processor.ts"]
 */

import { z, type ZodType } from "zod";

/**
 * Generate a human-readable schema description from a Zod schema
 * Useful for providing context to LLMs for fixing validation errors.
 */
export function describeSchema<T>(
  schema: ZodType<T>,
): string {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodType<unknown>>;
    const fields = Object.entries(shape)
      .map(([key, val]) => `  "${key}": ${describeSchema(val)}`)
      .join(",\n");
    return `{\n${fields}\n}`;
  }

  if (schema instanceof z.ZodArray) {
    return `Array<${describeSchema(schema.element as ZodType<unknown>)}>`;
  }

  if (schema instanceof z.ZodString) {
    return "string";
  }

  if (schema instanceof z.ZodNumber) {
    return "number";
  }

  if (schema instanceof z.ZodBoolean) {
    return "boolean";
  }

  // z.nativeEnum() also constructs a ZodEnum instance in v4 — this covers both call forms.
  if (schema instanceof z.ZodEnum) {
    const values = Object.values(schema.enum).filter((v): v is string => typeof v === "string");
    return `enum(${values.join(" | ")})`;
  }

  if (schema instanceof z.ZodOptional) {
    return `optional(${describeSchema(schema.unwrap() as ZodType<unknown>)})`;
  }

  if (schema instanceof z.ZodPipe) {
    // .transform()/.refine() compile to a pipe in v4 — describe the pre-transform input shape.
    return describeSchema(schema.in as ZodType<unknown>);
  }

  return "unknown";
}
