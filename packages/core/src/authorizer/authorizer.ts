/**
 * @module Authorizer
 * @path packages/core/src/authorizer/authorizer.ts
 * @architectural-layer Core
 * @related-files []
 * @description Authorization contracts (Phase 115 Step 5 — minimal basis).
 *
 * IAuthorizer is the seam for entitlement decisions. The Solo default
 * (AllowAllAuthorizer) permits everything. Enterprise editions replace
 * it with a policy-driven authorizer wired through ICapabilityModule.
 */

/**
 * An action a caller wants to perform.
 * Concrete values are edition-specific; the interface is intentionally generic.
 */
export type AuthorizationAction = string;

/**
 * The resource the action targets.
 * Concrete values are edition-specific; the interface is intentionally generic.
 */
export type AuthorizationResource = string;

/**
 * Contextual information for an authorization decision.
 */
export interface IAuthorizationContext {
  /** Identity performing the action (user, agent, system). */
  identity?: string;
  /** Additional key-value attributes (role, tenant, scope, etc.). */
  attributes?: { [key: string]: boolean | number | string };
}

/**
 * Result of an authorization check.
 */
export interface IAuthorizationDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Authorization seam — the single attach point for entitlement logic.
 * Solo ships AllowAllAuthorizer (all permitted). Enterprise editions
 * implement policy-driven authorizers that register via
 * ICapabilityModule.registerEntitlement().
 */
export interface IAuthorizer {
  /**
   * Check whether an action on a resource is authorized.
   * Returns a decision with the outcome and optional reason.
   */
  authorize(
    action: AuthorizationAction,
    resource: AuthorizationResource,
    context?: IAuthorizationContext,
  ): IAuthorizationDecision;
}

/**
 * Default Solo authorizer — permits every action unconditionally.
 * Used by SoloComposer; Enterprise editions replace this via
 * registerCapabilityModule on the composer.
 */
export class AllowAllAuthorizer implements IAuthorizer {
  authorize(
    _action: AuthorizationAction,
    _resource: AuthorizationResource,
    _context?: IAuthorizationContext,
  ): IAuthorizationDecision {
    return { allowed: true, reason: "AllowAllAuthorizer: all actions permitted" };
  }
}
