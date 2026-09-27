/**
 * @module CompatibleStructuredOutput
 * @path packages/ai-openai/src/compatible_structured_output.ts
 * @description Provider-owned structured-output contract for OpenAI-compatible profiles: a
 *   supported JSON-Schema subset check, OpenAI strict-schema normalization (with a matching
 *   response-side null-stripping round trip), DeepSeek's json-mode dispatch, and local
 *   validation of the model's final JSON against the caller's original schema.
 * @architectural-layer AI
 * @dependencies [zod]
 * @related-files [packages/ai-openai/src/compatible_chat.ts, packages/core/src/planning/plan_adapter.ts]
 */
import { z } from "zod";
import type { JSONValue } from "@exaix/core";
import type { StructuredOutputMode, StructuredOutputModeReason } from "@exaix/ai/providers";
import {
  STRUCTURED_OUTPUT_JSON_MODE_INSTRUCTION,
  STRUCTURED_OUTPUT_SCHEMA_MAX_BYTES,
  STRUCTURED_OUTPUT_SCHEMA_MAX_NESTING,
} from "./constants.ts";

export type StructuredOutputProfile = "openai" | "deepseek" | "local-test";

/** Wire dispatch chosen by planStructuredOutput for a given profile + schema. */
export interface IStructuredOutputPlan {
  mode: StructuredOutputMode;
  reason?: StructuredOutputModeReason;
  responseFormat: Record<string, JSONValue>;
  /** Appended to the prompt only in json_object mode (the literal word "json" must appear). */
  promptInstruction?: string;
}

/** Thrown when a schema uses an unsupported keyword, reference, size, or nesting depth. */
export class UnsupportedJsonSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedJsonSchemaError";
  }
}

/** The JSON-Schema keyword naming an object's non-optional property list. */
const JSON_SCHEMA_KEYWORD_REQUIRED = "required";

/** Only these keywords may appear anywhere in a supported schema. Composition beyond anyOf
 *  (oneOf/allOf/not), pattern-based keywords, and conditionals are deliberately excluded — the
 *  wire-strict normalization below assumes this exact shape. */
const SUPPORTED_KEYWORDS = new Set([
  "type",
  "properties",
  JSON_SCHEMA_KEYWORD_REQUIRED,
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "$defs",
  "$ref",
  "title",
  "description",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

const LOCAL_REF_PATTERN = /^#\/\$defs\/([^/]+)$/;

function isPlainObject(value: JSONValue): value is Record<string, JSONValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface IWalkContext {
  defs: Record<string, JSONValue>;
  /** $defs names currently on the walk stack — a $ref back to one of these is a cycle. */
  visiting: Set<string>;
}

/** Enforces the keyword allowlist, nesting cap, and $ref rules on one schema node. */
function walkNode(node: JSONValue, ctx: IWalkContext, depth: number): void {
  if (depth > STRUCTURED_OUTPUT_SCHEMA_MAX_NESTING) {
    throw new UnsupportedJsonSchemaError(
      `schema nesting exceeds ${STRUCTURED_OUTPUT_SCHEMA_MAX_NESTING} levels`,
    );
  }
  if (!isPlainObject(node)) {
    throw new UnsupportedJsonSchemaError("schema node must be an object");
  }
  for (const key of Object.keys(node)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw new UnsupportedJsonSchemaError(`unsupported schema keyword: ${key}`);
    }
  }

  if (node.$ref !== undefined) {
    if (typeof node.$ref !== "string") throw new UnsupportedJsonSchemaError("$ref must be a string");
    walkRef(node.$ref, ctx, depth);
    return;
  }

  walkChildSchemas(node, ctx, depth);
}

function walkChildSchemas(node: Record<string, JSONValue>, ctx: IWalkContext, depth: number): void {
  const properties = node.properties;
  if (properties !== undefined) {
    if (!isPlainObject(properties)) throw new UnsupportedJsonSchemaError("properties must be an object");
    for (const propSchema of Object.values(properties)) {
      walkNode(propSchema, ctx, depth + 1);
    }
  }
  if (node.required !== undefined && !Array.isArray(node.required)) {
    throw new UnsupportedJsonSchemaError("required must be an array");
  }
  const additionalProperties = node.additionalProperties;
  if (additionalProperties !== undefined && typeof additionalProperties !== "boolean") {
    walkNode(additionalProperties, ctx, depth + 1);
  }
  if (node.items !== undefined) walkNode(node.items, ctx, depth + 1);
  if (node.anyOf !== undefined) {
    if (!Array.isArray(node.anyOf)) throw new UnsupportedJsonSchemaError("anyOf must be an array");
    for (const branch of node.anyOf) walkNode(branch, ctx, depth + 1);
  }
  if (node.$defs !== undefined && !isPlainObject(node.$defs)) {
    throw new UnsupportedJsonSchemaError("$defs must be an object");
  }
}

function walkRef(ref: string, ctx: IWalkContext, depth: number): void {
  const match = LOCAL_REF_PATTERN.exec(ref);
  if (!match) throw new UnsupportedJsonSchemaError(`unsupported $ref (must be a local #/$defs/ reference): ${ref}`);
  const name = match[1];
  if (ctx.visiting.has(name)) throw new UnsupportedJsonSchemaError(`recursive $ref detected: ${ref}`);
  const target = ctx.defs[name];
  if (target === undefined) throw new UnsupportedJsonSchemaError(`$ref target not found in $defs: ${ref}`);
  ctx.visiting.add(name);
  walkNode(target, ctx, depth + 1);
  ctx.visiting.delete(name);
}

/** Throws UnsupportedJsonSchemaError, or returns normally when the schema is supported. */
export function assertSupportedJsonSchema(schema: Record<string, JSONValue>): void {
  const byteLength = new TextEncoder().encode(JSON.stringify(schema)).length;
  if (byteLength > STRUCTURED_OUTPUT_SCHEMA_MAX_BYTES) {
    throw new UnsupportedJsonSchemaError(`schema exceeds ${STRUCTURED_OUTPUT_SCHEMA_MAX_BYTES} bytes`);
  }
  const defs = isPlainObject(schema.$defs) ? schema.$defs : {};
  const ctx: IWalkContext = { defs, visiting: new Set() };
  walkNode(schema, ctx, 0);
  for (const [name, def] of Object.entries(defs)) {
    ctx.visiting.add(name);
    walkNode(def, ctx, 1);
    ctx.visiting.delete(name);
  }
}

/** True iff every object closes with a boolean `additionalProperties`, never a "record". */
export function isStrictRepresentable(schema: Record<string, JSONValue>): boolean {
  const defs = isPlainObject(schema.$defs) ? schema.$defs : {};
  const seen = new Set<JSONValue>();
  const check = (node: JSONValue): boolean => {
    if (!isPlainObject(node) || seen.has(node)) return true;
    seen.add(node);
    if (typeof node.$ref === "string") {
      const match = LOCAL_REF_PATTERN.exec(node.$ref);
      return match ? check(defs[match[1]]) : true;
    }
    if (isPlainObject(node.additionalProperties)) return false;
    if (isPlainObject(node.properties) && !Object.values(node.properties).every(check)) return false;
    if (node.items !== undefined && !check(node.items)) return false;
    if (Array.isArray(node.anyOf) && !node.anyOf.every(check)) return false;
    return true;
  };
  return check(schema) && Object.values(defs).every(check);
}

/** True iff the original property schema allows `null` — a strip-safe null, not strict mode's. */
function originalSchemaAllowsNull(propSchema: JSONValue): boolean {
  if (!isPlainObject(propSchema)) return false;
  if (propSchema.type === "null") return true;
  if (Array.isArray(propSchema.anyOf)) return propSchema.anyOf.some((branch) => originalSchemaAllowsNull(branch));
  return false;
}

/** Closes every object and makes each optional property required and nullable (strict mode). */
export function toStrictSchema(schema: Record<string, JSONValue>): Record<string, JSONValue> {
  const strictifyNode = (node: JSONValue): JSONValue => {
    if (!isPlainObject(node)) return node;
    const out: Record<string, JSONValue> = { ...node };
    if (isPlainObject(node.properties)) {
      const requiredSet = new Set(Array.isArray(node.required) ? node.required as string[] : []);
      const strictProps: Record<string, JSONValue> = {};
      for (const [key, propSchema] of Object.entries(node.properties)) {
        const strictProp = strictifyNode(propSchema);
        strictProps[key] = requiredSet.has(key) || originalSchemaAllowsNull(propSchema)
          ? strictProp
          : { anyOf: [strictProp, { type: "null" }] };
      }
      out.properties = strictProps;
      out.required = Object.keys(node.properties);
    }
    if (typeof node.additionalProperties === "boolean" || node.type === "object") {
      out.additionalProperties = false;
    }
    if (node.items !== undefined) out.items = strictifyNode(node.items);
    if (Array.isArray(node.anyOf)) out.anyOf = node.anyOf.map(strictifyNode);
    return out;
  };
  const strict = strictifyNode(schema) as Record<string, JSONValue>;
  if (isPlainObject(schema.$defs)) {
    const strictDefs: Record<string, JSONValue> = {};
    for (const [name, def] of Object.entries(schema.$defs)) strictDefs[name] = strictifyNode(def);
    strict.$defs = strictDefs;
  }
  return strict;
}

/** Reverses toStrictSchema: drops a `null` that was optional and didn't originally allow it. */
export function stripIntroducedNulls(data: JSONValue, originalSchema: Record<string, JSONValue>): JSONValue {
  const strip = (value: JSONValue, node: JSONValue): JSONValue => {
    if (!isPlainObject(node)) return value;
    if (Array.isArray(value) && node.items !== undefined) {
      return value.map((item) => strip(item, node.items));
    }
    if (isPlainObject(value) && isPlainObject(node.properties)) {
      const requiredSet = new Set(Array.isArray(node.required) ? node.required as string[] : []);
      const out: Record<string, JSONValue> = {};
      for (const [key, fieldValue] of Object.entries(value)) {
        const propSchema = node.properties[key];
        const wasOptional = propSchema !== undefined && !requiredSet.has(key);
        if (fieldValue === null && wasOptional && !originalSchemaAllowsNull(propSchema)) continue;
        out[key] = propSchema !== undefined ? strip(fieldValue, propSchema) : fieldValue;
      }
      return out;
    }
    return value;
  };
  return strip(data, originalSchema);
}

const OPENAI_STRICT_SCHEMA_NAME = "exaix_structured_output";

/** OpenAI prefers strict json_schema mode when representable — DeepSeek always uses json_object. */
export function planStructuredOutput(
  profile: StructuredOutputProfile,
  schema: Record<string, JSONValue>,
): IStructuredOutputPlan {
  assertSupportedJsonSchema(schema);
  const strict = profile !== "deepseek" && isStrictRepresentable(schema);
  if (strict) {
    return {
      mode: "json_schema",
      responseFormat: {
        type: "json_schema",
        json_schema: { name: OPENAI_STRICT_SCHEMA_NAME, strict: true, schema: toStrictSchema(schema) },
      },
    };
  }
  return {
    mode: "json_object",
    ...(profile !== "deepseek" ? { reason: "schema_not_strict_representable" as const } : {}),
    responseFormat: { type: "json_object" },
    promptInstruction: STRUCTURED_OUTPUT_JSON_MODE_INSTRUCTION,
  };
}

/** Validates content against the ORIGINAL schema, after reversing strict mode's null strip. */
export function validateStructuredOutput(
  content: string,
  originalSchema: Record<string, JSONValue>,
  _profile: StructuredOutputProfile,
): JSONValue {
  let parsed: JSONValue;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new UnsupportedJsonSchemaError("structured output content is not valid JSON");
  }
  const normalized = stripIntroducedNulls(parsed, originalSchema);
  const validator = z.fromJSONSchema(originalSchema);
  return validator.parse(normalized) as JSONValue;
}
