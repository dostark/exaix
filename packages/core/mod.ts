/**
 * @module CorePackage
 * @path packages/core/mod.ts
 * @description Package entrypoint for @exaix/core. This package houses core contracts, types, and shared primitives.
 */
import type { JSONArray, JSONObject, JSONValue, LogMetadata } from "./src/types/json.ts";
import { jsonExtract, JSONValueSchema, toSafeJson } from "./src/types/json.ts";
export { SYSTEM_ACTIVITY_ACTOR } from "./src/constants.ts";

export type { JSONArray, JSONObject, JSONValue, LogMetadata };
export { jsonExtract, JSONValueSchema, toSafeJson };
