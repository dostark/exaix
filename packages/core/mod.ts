/**
 * @module CorePackage
 * @path packages/core/mod.ts
 * @description Package entrypoint for @exaix/core. This package houses core contracts, types, and shared primitives.
 */

export * from "./src/types/enums.ts";
export * from "./src/types/constants.ts";
export * from "./src/version.ts";
export * from "./src/status/mod.ts";
export * from "./src/request/mod.ts";
export type { IPortalDetails, IPortalInfo, IVerificationResult } from "./src/types/portal.ts";
export { PortalAnalysisMode, PortalExecutionStrategy, PortalOperation, PortalStatus } from "./src/types/portal.ts";

export type { JSONArray, JSONObject, JSONValue, LogMetadata } from "./src/types/json.ts";
export { jsonExtract, JSONValueSchema, toSafeJson } from "./src/types/json.ts";
