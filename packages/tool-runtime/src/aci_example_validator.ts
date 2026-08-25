/**
 * @module AciExampleValidator
 * @path packages/tool-runtime/src/aci_example_validator.ts
 * @description Phase 112 Step 4 — pure worked-example compatibility check: verifies that an
 *   ACI example's input record uses only known tool parameters, includes every required
 *   parameter, and gives each value a JS runtime type (and, where declared, enum member)
 *   matching the tool's own `ITool.parameters` JSON-schema contract. Used by the ACI catalog
 *   test to prove every worked example is real and every anti-example genuinely violates a
 *   named constraint, and reused by Step 5's `scripts/validate_aci_docs.ts`.
 * @architectural-layer Services
 * @related-files ["packages/tool-runtime/src/tool_schemas.ts", "packages/schemas/src/aci_doc.ts"]
 */
import { JsonSchemaType } from "@exaix/core";
import type { IToolParameterSchema, IToolSchema } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";

/** Result of checking one example (or anti-example) input against a tool's parameter schema. */
export interface IAciExampleValidationResult {
  compatible: boolean;
  /** Human-readable, named-constraint violations; empty when compatible. */
  violations: string[];
}

/** Whether `value`'s JS runtime type matches a declared JSON-schema primitive `type` name.
 * Unknown/unrecognized declared type names are not treated as a violation here — that is a
 * schema-authoring concern for a different check, not an example-compatibility one. */
function matchesJsonSchemaType(value: JSONValue, schema: IToolParameterSchema): boolean {
  switch (schema.type) {
    case JsonSchemaType.STRING:
      return typeof value === "string";
    case JsonSchemaType.NUMBER:
      return typeof value === "number";
    case JsonSchemaType.BOOLEAN:
      return typeof value === "boolean";
    case JsonSchemaType.ARRAY:
      return Array.isArray(value);
    case JsonSchemaType.OBJECT:
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case JsonSchemaType.NULL:
      return value === null;
    default:
      return true;
  }
}

/**
 * Checks `input` against `parameters`: every key must be a known property, every required
 * property must be present, and every present value's type (and enum membership, where
 * declared) must match its property's schema. Pure — no I/O, no tool execution.
 */
export function validateAciExampleAgainstSchema(
  parameters: IToolSchema,
  input: Record<string, JSONValue>,
): IAciExampleValidationResult {
  const violations: string[] = [];

  for (const key of Object.keys(input)) {
    if (!(key in parameters.properties)) {
      violations.push(`unknown parameter '${key}'`);
    }
  }

  for (const requiredKey of parameters.required ?? []) {
    if (!(requiredKey in input)) {
      violations.push(`missing required parameter '${requiredKey}'`);
    }
  }

  for (const [key, value] of Object.entries(input)) {
    const schema = parameters.properties[key];
    if (!schema) continue; // already reported as an unknown parameter above
    if (!matchesJsonSchemaType(value, schema)) {
      violations.push(`parameter '${key}' expected type '${schema.type}', got '${typeof value}'`);
      continue;
    }
    if (schema.enum && typeof value === "string" && !schema.enum.includes(value)) {
      violations.push(`parameter '${key}' value '${value}' is not one of [${schema.enum.join(", ")}]`);
    }
  }

  return { compatible: violations.length === 0, violations };
}
