/**
 * @module AllowAllPermissionsService
 * @path packages/mcp/testing/allow_all_permissions.ts
 * @related-files []
 * @architectural-layer MCP
 * @ungrounded
 * @description Test-only portal permissions fixture that explicitly permits all portal operations.
 * Implements IPortalPermissionsChecker without importing from root src/ — safe for package tests.
 * Must never be imported from production runtime code.
 */

import type {
  IAgentWhitelistResult,
  IPermissionCheckResult,
  IPortalPermissionsChecker,
} from "@exaix/schemas/portal_permissions.ts";

import type { PortalOperation } from "@exaix/core";

/** Explicit permissive test fixture — must never be imported from production runtime code. */
export class AllowAllPermissionsService implements IPortalPermissionsChecker {
  checkAgentAllowed(portalAlias: string, agentRole: string): IAgentWhitelistResult {
    return {
      allowed: true,
      portal: portalAlias,
      agent_role: agentRole,
    };
  }

  checkOperationAllowed(
    portalAlias: string,
    agentRole: string,
    operation: PortalOperation,
  ): IPermissionCheckResult {
    return {
      allowed: true,
      portal: portalAlias,
      agent_role: agentRole,
      operation,
    };
  }
}
