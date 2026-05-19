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
export type { ICostTracker } from "./src/types/i_cost_tracker.ts";
export type { IDatabaseService } from "./src/types/i_database_service.ts";
export type { IServiceContext } from "./src/types/service_context.ts";
export * from "./src/version.ts";
export type { IPortalDetails, IPortalInfo, IVerificationResult } from "./src/types/portal.ts";
export { PortalAnalysisMode, PortalExecutionStrategy, PortalOperation, PortalStatus } from "./src/types/portal.ts";

export type { JSONArray, JSONObject, JSONValue, LogMetadata } from "./src/types/json.ts";
export { jsonExtract, JSONValueSchema, toSafeJson } from "./src/types/json.ts";

export { SecureCredentialStore } from "./src/helpers/credential_security.ts";
