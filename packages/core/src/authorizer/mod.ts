/**
 * @module AuthorizerBarrel
 * @path packages/core/src/authorizer/mod.ts
 * @architectural-layer Core
 * @ungrounded
 * @related-files []
 * @description Barrel export for authorization types (Phase 115 Step 5).
 */

export type { AuthorizationAction, AuthorizationResource } from "./authorizer.ts";
export type { IAuthorizationContext, IAuthorizationDecision, IAuthorizer } from "./authorizer.ts";
export { AllowAllAuthorizer } from "./authorizer.ts";
