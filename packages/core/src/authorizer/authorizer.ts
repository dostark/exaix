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

import type { Opt, Reason } from "../types/optional_marker.ts";

/** Concrete values are edition-specific; the interface is intentionally generic. */
export type AuthorizationAction = string;

/** Concrete values are edition-specific; the interface is intentionally generic. */
export type AuthorizationResource = string;

/**
 * Contextual information for an authorization decision.
 */
export interface IAuthorizationContext {
  /** Agent role performing the action (user, agent, system). */
  agent_role?: string;
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

/** The single attach point for entitlement logic. Solo ships AllowAllAuthorizer;
 *  Enterprise editions register policy-driven authorizers via
 *  ICapabilityModule.registerEntitlement(). */
export interface IAuthorizer {
  /** Checks whether an action on a resource is authorized. */
  authorize(
    action: AuthorizationAction,
    resource: AuthorizationResource,
    context?: IAuthorizationContext,
  ): IAuthorizationDecision;
}

/** Permits every action unconditionally. Enterprise editions replace this via
 *  registerCapabilityModule on the composer. */
export class AllowAllAuthorizer implements IAuthorizer {
  authorize(
    _action: AuthorizationAction,
    _resource: AuthorizationResource,
    _context?: Opt<IAuthorizationContext, Reason.AbstractBoundary>,
  ): IAuthorizationDecision {
    return { allowed: true, reason: "AllowAllAuthorizer: all actions permitted" };
  }
}
