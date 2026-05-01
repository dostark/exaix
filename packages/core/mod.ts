/**
 * @module CorePackage
 * @path packages/core/mod.ts
 * @description Package entrypoint for @exaix/core. This package houses core contracts, types, and shared primitives.
 */

export * from "./src/types/enums.ts";
export * from "./src/types/constants.ts";
export { ActorType } from "./src/types/actor.ts";
export type { Actor } from "./src/types/actor.ts";
export type { ILogEvent } from "./src/types/i_log_event.ts";
export { EventBusService } from "./src/observability/mod.ts";
export type { IEventBusService } from "./src/observability/mod.ts";
export * from "./src/version.ts";
export * from "./src/status/mod.ts";
export * from "./src/request/mod.ts";
export * from "./src/repositories/mod.ts";
export type { IPortalDetails, IPortalInfo, IVerificationResult } from "./src/types/portal.ts";
export { PortalAnalysisMode, PortalExecutionStrategy, PortalOperation, PortalStatus } from "./src/types/portal.ts";

export type { JSONArray, JSONObject, JSONValue, LogMetadata } from "./src/types/json.ts";
export { jsonExtract, JSONValueSchema, toSafeJson } from "./src/types/json.ts";
export * from "./mod.ts";
