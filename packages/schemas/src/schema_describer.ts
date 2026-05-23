/**
 * @module SchemaDescriber
 * @path packages/schemas/src/schema_describer.ts
 * @description Provides a utility function to generate human-readable descriptions from Zod schemas, aiding LLMs in resolving validation errors.
 * @architectural-layer Schemas
 * @ungrounded
 * @related-files ["packages/request/src/processor.ts"]
 */

import type { ZodType, ZodTypeDef } from "zod";
import type { JSONObject } from "@exaix/core";

/**
 * Generate a human-readable schema description from a Zod schema
 * Useful for providing context to LLMs for fixing validation errors.
 */
export function describeSchema<T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
): string {
  // Get schema description from Zod's internal structure
  const def = schema._def as JSONObject;

  if ("typeName" in def) {
    switch (def.typeName) {
      case "ZodObject": {
        const shapeFn = def.shape;
        if (typeof shapeFn === "function") {
          const shape = (shapeFn as () => Record<string, ZodType<unknown>>)();
          const fields = Object.entries(shape)
            .map(([key, val]) => `  "${key}": ${describeSchema(val)}`)
            .join(",\n");
          return `{\n${fields}\n}`;
        }
        return "object";
      }
      case "ZodArray": {
        const typeProp = def.type as ZodType<unknown> | undefined;
        if (typeProp) {
          return `Array<${describeSchema(typeProp)}>`;
        }
        return "Array<unknown>";
      }
      case "ZodString":
        return "string";
      case "ZodNumber":
        return "number";
      case "ZodBoolean":
        return "boolean";
      case "ZodEnum": {
        const values = def.values as string[] | undefined;
        if (values) {
          return `enum(${values.join(" | ")})`;
        }
        return "enum";
      }
      case "ZodOptional": {
        const innerType = def.innerType as ZodType<unknown> | undefined;
        if (innerType) {
          return `optional(${describeSchema(innerType)})`;
        }
        return "optional(unknown)";
      }
      case "ZodEffects": {
        const schemaProp = def.schema as ZodType<unknown> | undefined;
        if (schemaProp) {
          return describeSchema(schemaProp);
        }
        return "refined(unknown)";
      }
      default:
        return "unknown";
    }
  }

  return "unknown";
}
