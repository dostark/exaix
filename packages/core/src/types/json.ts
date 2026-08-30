/**
 * @module SharedTypes
 * @path packages/core/src/types/json.ts
 * @description Centralized JSON-related types and utilities shared between Core and TUI.
 * @architectural-layer Shared
 * @related-files [packages/core/src/types/constants.ts, packages/schemas/src/*.ts]
 */
import { z } from "zod";

/**
 * Represents a JSON-serializable value.
 */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | { [key: string]: JSONValue }
  | JSONValue[];

/**
 * Represents a JSON-serializable object.
 */
export type JSONObject = { [key: string]: JSONValue };

/**
 * Represents a JSON-serializable array.
 */
export type JSONArray = JSONValue[];

/**
 * Metadata for logging events, restricted to JSON-serializable values.
 */
export type LogMetadata = JSONObject;

/**
 * Zod schema for JSONValue to support recursive validation.
 */
export const JSONValueSchema: z.ZodType<JSONValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JSONValueSchema),
    z.record(z.string(), JSONValueSchema),
  ])
);

/**
 * Input values accepted by `toSafeJson`.
 */
export type SafeJsonInput =
  | string
  | number
  | boolean
  | null
  | undefined
  | SafeJsonInput[]
  | { [key: string]: SafeJsonInput };

/** Converts a value to JSONValue by stripping undefined properties (for the Activity Journal). */
export function toSafeJson(value: SafeJsonInput): JSONValue {
  if (value === undefined || value === null) return null;

  if (Array.isArray(value)) {
    return value.map((item) => toSafeJson(item));
  }

  if (typeof value === "object") {
    const result: { [key: string]: JSONValue } = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) {
        result[key] = toSafeJson(val);
      }
    }
    return result;
  }

  return value as JSONValue;
}

/** Extracts a field from a JSON string via dot notation (e.g. "user.profile.age", "items.0.name"). */
export function jsonExtract(input: string, fieldPath: string): JSONValue {
  let data: JSONValue;
  try {
    data = JSON.parse(input) as JSONValue;
  } catch (error) {
    throw new Error(`Invalid JSON input: ${(error as Error).message}`);
  }

  const path = fieldPath.split(".");
  let current: JSONValue = data;

  for (const segment of path) {
    if (current === null || current === undefined) {
      throw new Error(`Field '${fieldPath}' not found`);
    }

    // Handle array indices
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      const index = parseInt(segment, 10);
      if (index >= current.length) {
        throw new Error(`Field '${fieldPath}' not found`);
      }
      current = current[index];
    } else if (typeof current === "object" && !Array.isArray(current) && segment in current) {
      current = current[segment];
    } else {
      throw new Error(`Field '${fieldPath}' not found`);
    }
  }

  return current;
}
