/**
 * @module PortalPermissionsService
 * @path packages/portal/src/portal_permissions.ts
 * @description Validates agent access to portals based on whitelist, operations, and security modes.
 * @architectural-layer Services
 * @related-files ["packages/schemas/src/portal_permissions.ts", "packages/core/src/logger/audit_logger.ts"]
 */

import type {
  IAgentWhitelistResult,
  IPermissionCheckResult,
  IPermissionConditions,
  IPortalPermissions,
  IPortalSecurityConfig,
  IRBACPermissionCheckResult,
} from "@exaix/schemas/portal_permissions.ts";

import type { IAuditLogger } from "@exaix/core/types";
import {
  PermissionAction,
  PortalOperation,
  SecurityEventResult,
  SecurityEventType,
  SecurityMode,
  SecuritySeverity,
} from "@exaix/core";
import { toSafeJson } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/**
 * Service for validating portal permissions
 */
export class PortalPermissionsService {
  private portals: Map<string, IPortalPermissions>;
  private auditLogger?: IAuditLogger;

  constructor(portals: IPortalPermissions[], auditLogger?: IAuditLogger) {
    this.portals = new Map();
    for (const portal of portals) {
      this.portals.set(portal.alias, portal);
    }
    this.auditLogger = auditLogger;
  }

  /**
   * Check if an agent is allowed to access a portal
   */
  checkAgentAllowed(portalAlias: string, identityId: string): IAgentWhitelistResult {
    const portal = this.portals.get(portalAlias);

    if (!portal) {
      return {
        allowed: false,
        reason: `Portal '${portalAlias}' not found`,
        portal: portalAlias,
        identity_id: identityId,
      };
    }

    // Check if agent is in whitelist
    const identitiesAllowed = portal.identities_allowed || ["*"];

    // Wildcard allows all agents
    if (identitiesAllowed.includes("*")) {
      return {
        allowed: true,
        portal: portalAlias,
        identity_id: identityId,
      };
    }

    // Check explicit whitelist
    if (identitiesAllowed.includes(identityId)) {
      return {
        allowed: true,
        portal: portalAlias,
        identity_id: identityId,
      };
    }

    return {
      allowed: false,
      reason: `Agent '${identityId}' is not allowed to access portal '${portalAlias}'`,
      portal: portalAlias,
      identity_id: identityId,
    };
  }

  /**
   * Check if an operation is allowed for an agent on a portal
   */
  checkOperationAllowed(
    portalAlias: string,
    identityId: string,
    operation: PortalOperation,
  ): IPermissionCheckResult {
    // First check if agent is allowed
    const agentCheck = this.checkAgentAllowed(portalAlias, identityId);
    if (!agentCheck.allowed) {
      return {
        allowed: false,
        reason: agentCheck.reason,
        portal: portalAlias,
        identity_id: identityId,
        operation,
      };
    }

    const portal = this.portals.get(portalAlias)!;

    // Check if operation is permitted
    const operations = portal.operations || [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT];
    if (!operations.includes(operation)) {
      return {
        allowed: false,
        reason: `Operation '${operation}' is not permitted on portal '${portalAlias}'`,
        portal: portalAlias,
        identity_id: identityId,
        operation,
      };
    }

    return {
      allowed: true,
      portal: portalAlias,
      identity_id: identityId,
      operation,
    };
  }

  /**
   * Get security mode for a portal
   */
  getSecurityMode(portalAlias: string): SecurityMode {
    const portal = this.portals.get(portalAlias);
    if (!portal || !portal.security) {
      return SecurityMode.SANDBOXED; // Default to most secure mode
    }

    return portal.security.mode;
  }

  /**
   * Get security configuration for a portal
   */
  getSecurityConfig(portalAlias: string): IPortalSecurityConfig | null {
    const portal = this.portals.get(portalAlias);
    if (!portal) {
      return null;
    }

    // Return security config or default
    return portal.security || {
      mode: SecurityMode.SANDBOXED,
      audit_enabled: true,
      log_all_actions: true,
    };
  }

  /**
   * Get portal configuration by alias
   */
  getPortal(portalAlias: string): IPortalPermissions | null {
    return this.portals.get(portalAlias) || null;
  }

  /**
   * List all portals accessible by an agent
   */
  listAccessiblePortals(identityId: string): IPortalPermissions[] {
    const accessible: IPortalPermissions[] = [];

    for (const portal of this.portals.values()) {
      const check = this.checkAgentAllowed(portal.alias, identityId);
      if (check.allowed) {
        accessible.push(portal);
      }
    }

    return accessible;
  }

  /**
   * Get all portal aliases
   */
  listPortalAliases(): string[] {
    return Array.from(this.portals.keys());
  }

  /**
   * Validate portal has git repository
   * Checks for .git directory in portal's target path
   */
  validateGitRepo(portalAlias: string): boolean {
    const portal = this.getPortal(portalAlias);

    if (!portal) {
      throw new Error(`Portal '${portalAlias}' not found`);
    }

    try {
      const gitDir = `${portal.target_path}/.git`;
      const stat = Deno.statSync(gitDir);
      return stat.isDirectory;
    } catch {
      // If .git doesn't exist or can't be accessed, return false
      return false;
    }
  }

  /**
   * List portals with git support
   * Returns only portals that have a .git directory
   */
  listGitEnabledPortals(): IPortalPermissions[] {
    const allPortals = Array.from(this.portals.values());
    return allPortals.filter((portal) => {
      try {
        return this.validateGitRepo(portal.alias);
      } catch {
        // If validation throws, portal doesn't have git
        return false;
      }
    });
  }

  /**
   * Enhanced RBAC permission check with resource/action/condition model
   */
  checkPermission(
    portalAlias: string,
    identityId: string,
    action: PermissionAction,
    resource: string,
    context?: { timestamp?: Date; ip?: string },
  ): IRBACPermissionCheckResult {
    const portal = this.portals.get(portalAlias);

    if (!portal) {
      const result = {
        allowed: false,
        reason: `Portal '${portalAlias}' not found`,
        portal: portalAlias,
        identity_id: identityId,
        action,
        resource,
      };
      this.logPermissionCheck(result, context);
      return result;
    }

    // If enhanced permissions are defined, use RBAC model
    if (portal.permissions && portal.permissions.length > 0) {
      const result = this.checkRBACPermissions(portal, identityId, action, resource, context);
      this.logPermissionCheck(result, context);
      return result;
    }

    // Fall back to legacy permission model for backward compatibility
    const result = this.checkLegacyPermissions(portal, identityId, action, resource);
    this.logPermissionCheck(result, context);
    return result;
  }

  /**
   * Log permission check results for audit purposes
   */
  private async logPermissionCheck(
    result: IRBACPermissionCheckResult,
    context?: Opt<{ timestamp?: Date; ip?: string }, Reason.OptionalContext>,
  ): Promise<void> {
    if (!this.auditLogger) return;

    const severity = result.allowed ? SecuritySeverity.LOW : SecuritySeverity.HIGH;
    const metadata: Record<string, JSONValue> = {
      reason: result.reason ?? null,
      conditions: result.conditions ? toSafeJson(result.conditions) : null,
    };

    if (context?.ip) metadata.ip = context.ip;
    if (context?.timestamp) metadata.timestamp = context.timestamp.toISOString();

    await this.auditLogger.logSecurityEvent({
      type: SecurityEventType.PERMISSION,
      action: "portal_access_check",
      actor: result.identity_id,
      resource: `${result.portal}:${result.resource}`,
      result: result.allowed ? SecurityEventResult.SUCCESS : SecurityEventResult.DENIED,
      metadata,
      severity,
    });
  }

  /**
   * Check permissions using enhanced RBAC model
   */
  private checkRBACPermissions(
    portal: IPortalPermissions,
    identityId: string,
    action: PermissionAction,
    resource: string,
    context?: Opt<{ timestamp?: Date; ip?: string }, Reason.OptionalContext>,
  ): IRBACPermissionCheckResult {
    const permissions = portal.permissions!;

    for (const perm of permissions) {
      if (!this.matchesResource(perm.resource, resource)) continue;
      if (!this.matchesAction(perm.action, action)) continue;

      // Check conditions if present
      if (
        perm.conditions && (perm.conditions.timeWindow || perm.conditions.ipWhitelist || perm.conditions.maxOperations)
      ) {
        const conditionCheck = this.checkConditions(perm.conditions!, context);
        if (!conditionCheck.allowed) {
          return {
            allowed: false,
            reason: conditionCheck.reason,
            portal: portal.alias,
            identity_id: identityId,
            action,
            resource,
            conditions: perm.conditions,
          };
        }
      }

      // Permission granted
      return {
        allowed: true,
        portal: portal.alias,
        identity_id: identityId,
        action,
        resource,
        conditions: perm.conditions,
      };
    }

    // No matching permission found
    return {
      allowed: false,
      reason: "No matching permission found",
      portal: portal.alias,
      identity_id: identityId,
      action,
      resource,
    };
  }

  /**
   * Check permissions using legacy model (for backward compatibility)
   */
  private checkLegacyPermissions(
    portal: IPortalPermissions,
    identityId: string,
    action: PermissionAction,
    resource: string,
  ): IRBACPermissionCheckResult {
    // Convert legacy model to RBAC for consistent interface

    // Check agent whitelist
    const identitiesAllowed = portal.identities_allowed || ["*"];
    if (!identitiesAllowed.includes("*") && !identitiesAllowed.includes(identityId)) {
      return {
        allowed: false,
        reason: `Agent '${identityId}' is not allowed to access portal '${portal.alias}'`,
        portal: portal.alias,
        identity_id: identityId,
        action,
        resource,
      };
    }

    // Check operation permissions (map to actions)
    const operations = portal.operations || [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT];
    const actionToOperation: Record<PermissionAction, PortalOperation | null> = {
      [PermissionAction.READ]: PortalOperation.READ,
      [PermissionAction.WRITE]: PortalOperation.WRITE,
      [PermissionAction.EXECUTE]: null, // No direct mapping
      [PermissionAction.DELETE]: null, // No direct mapping
    };

    const requiredOperation = actionToOperation[action];
    if (requiredOperation && !operations.includes(requiredOperation)) {
      return {
        allowed: false,
        reason: `Action '${action}' is not permitted on portal '${portal.alias}'`,
        portal: portal.alias,
        identity_id: identityId,
        action,
        resource,
      };
    }

    // Special handling for execute/delete actions
    if (action === PermissionAction.EXECUTE && !operations.includes(PortalOperation.GIT)) {
      return {
        allowed: false,
        reason: `Execute action requires git operation permission`,
        portal: portal.alias,
        identity_id: identityId,
        action,
        resource,
      };
    }

    if (action === PermissionAction.DELETE && !operations.includes(PortalOperation.WRITE)) {
      return {
        allowed: false,
        reason: `Delete action requires write operation permission`,
        portal: portal.alias,
        identity_id: identityId,
        action,
        resource,
      };
    }

    return {
      allowed: true,
      portal: portal.alias,
      identity_id: identityId,
      action,
      resource,
    };
  }

  /**
   * Check if resource pattern matches the requested resource
   */
  private matchesResource(pattern: string, resource: string): boolean {
    // Simple glob-style matching
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*/g, ".*") // * matches any characters
      .replace(/\?/g, ".") // ? matches single character
      .replace(/\//g, "\\/"); // Escape forward slashes

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(resource);
  }

  /**
   * Check if permission action matches requested action
   */
  private matchesAction(
    permissionAction: PermissionAction | PermissionAction[],
    requestedAction: PermissionAction,
  ): boolean {
    const actions = Array.isArray(permissionAction) ? permissionAction : [permissionAction];

    if (actions.includes(requestedAction)) {
      return true;
    }

    // Handle implied permissions
    if (requestedAction === PermissionAction.READ) {
      // WRITE and EXECUTE both imply READ access
      return actions.includes(PermissionAction.WRITE) || actions.includes(PermissionAction.EXECUTE);
    }

    if (requestedAction === PermissionAction.WRITE) {
      // DELETE implies WRITE access
      return actions.includes(PermissionAction.DELETE);
    }

    return false;
  }

  /**
   * Check permission conditions
   */
  private checkConditions(
    conditions: NonNullable<IPermissionConditions>,
    context?: Opt<{ timestamp?: Date; ip?: string }, Reason.OptionalContext>,
  ): { allowed: boolean; reason?: string } {
    if (!context) {
      // If no context provided but conditions exist, deny access
      return { allowed: false, reason: "Context required for conditional permissions" };
    }

    // Check time window
    if (conditions.timeWindow) {
      const now = context.timestamp || new Date();
      const currentTime = now.toTimeString().slice(0, 5); // HH:MM format

      const start = conditions.timeWindow.start;
      const end = conditions.timeWindow.end;

      if (currentTime < start || currentTime > end) {
        return { allowed: false, reason: `Access denied outside time window ${start}-${end}` };
      }
    }

    // Check IP whitelist
    if (conditions.ipWhitelist && conditions.ipWhitelist.length > 0) {
      const clientIP = context.ip;
      if (!clientIP) {
        return { allowed: false, reason: "IP address required for IP-restricted permissions" };
      }

      // Simple IP matching (could be enhanced with CIDR support)
      if (!conditions.ipWhitelist.includes(clientIP)) {
        return { allowed: false, reason: `IP ${clientIP} not in whitelist` };
      }
    }

    // Note: maxOperations would need additional state tracking
    // For now, we don't enforce it in this basic implementation

    return { allowed: true };
  }
}
