/**
 * @module AllowAllPermissionsService
 * @path packages/mcp/testing/allow_all_permissions.ts
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

/**
 * Explicit permissive test fixture for MCP handlers and server tests.
 * This must never be imported from production runtime code.
 */
export class AllowAllPermissionsService implements IPortalPermissionsChecker {
  checkAgentAllowed(portalAlias: string, identityId: string): IAgentWhitelistResult {
    return {
      allowed: true,
      portal: portalAlias,
      identity_id: identityId,
    };
  }

  checkOperationAllowed(
    portalAlias: string,
    identityId: string,
    operation: PortalOperation,
  ): IPermissionCheckResult {
    return {
      allowed: true,
      portal: portalAlias,
      identity_id: identityId,
      operation,
    };
  }
}
