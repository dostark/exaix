/**
 * @module SharedTypesShim
 * @path src/shared/types/json.ts
 * @description Compatibility shim for the shared JSON types now owned by @exaix/core.
 * @architectural-layer Shared
 * @related-files [packages/core/src/types/json.ts, packages/core/mod.ts]
 */
import type {
  JSONArray as CoreJSONArray,
  JSONObject as CoreJSONObject,
  JSONValue as CoreJSONValue,
  LogMetadata as CoreLogMetadata,
} from "@exaix/core";
import {
  jsonExtract as coreJsonExtract,
  JSONValueSchema as coreJSONValueSchema,
  toSafeJson as coreToSafeJson,
} from "@exaix/core";

export type JSONValue = CoreJSONValue;
export type JSONObject = CoreJSONObject;
export type JSONArray = CoreJSONArray;
export type LogMetadata = CoreLogMetadata;

export const JSONValueSchema = coreJSONValueSchema;
export const toSafeJson = coreToSafeJson;
export const jsonExtract = coreJsonExtract;
