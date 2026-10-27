/**
 * @module CorePackage
 * @path packages/core/mod.ts
 * @architectural-layer Core
 * @related-files []
 * @description Package entrypoint for @exaix/core. This package houses core contracts, types, and shared primitives.
 */

export * from "./src/types/enums.ts";
// The shared constants live in @exaix/shared, the lower layer.
export * from "./src/types/constants.ts";
export * from "./src/types/tool_aliases.ts";
export { ActorType } from "./src/types/actor.ts";
export type { Actor } from "./src/types/actor.ts";
export type { ILogEvent } from "./src/types/i_log_event.ts";
export type { ICostTracker } from "./src/types/i_cost_tracker.ts";
export type { IDatabaseService } from "./src/types/i_database_service.ts";
export type { IServiceContext } from "./src/types/service_context.ts";
export * from "./src/version.ts";
export type { IPortalDetails, IPortalInfo, IVerificationResult } from "./src/types/portal.ts";
export { PortalAnalysisMode, PortalExecutionStrategy, PortalOperation, PortalStatus } from "./src/types/portal.ts";
export { PortalKnowledgeInclusion } from "./src/types/portal.ts";

export type { JSONObject, JSONValue, LogMetadata } from "./src/types/json.ts";
export { jsonExtract, JSONValueSchema, toSafeJson } from "./src/types/json.ts";

export { SecureCredentialStore } from "./src/helpers/credential_security.ts";

export type { IProviderDefaults } from "./src/types/provider_defaults.ts";
export { ProviderDefaultsRegistry } from "./src/types/provider_defaults.ts";

export { SafeSubprocess, SubprocessError, SubprocessTimeoutError } from "./src/helpers/subprocess.ts";
export type { ISubprocessOptions } from "./src/helpers/subprocess.ts";

export { ProcessManager } from "./src/process_manager.ts";

export { PromptBudgetAllocator } from "./src/prompt_budget_allocator.ts";
export type { IAllocationHints } from "./src/prompt_budget_allocator.ts";

export type { IAuthorizationContext, IAuthorizer } from "./src/authorizer/authorizer.ts";
export { AllowAllAuthorizer } from "./src/authorizer/authorizer.ts";

export {
  ALLOWED_PARENT_ENV_KEYS,
  buildAllowlistChildEnv,
  buildChildEnv,
  isInjectionEnvVar,
  scrubProcessEnv,
  SECRET_ENV_PATTERN,
} from "./src/helpers/child_env.ts";
