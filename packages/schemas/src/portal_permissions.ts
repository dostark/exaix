/**
 * @module PortalPermissionsSchema
 * @path src/shared/schemas/portal_permissions.ts
 * @description Defines security modes, permission controls, and RBAC models for portal access.
 * @architectural-layer Schemas
 * @related-files ["src/services/request/request_processor.ts", src/cli/portal_commands.ts]
 */

import { z } from "zod";
import { DEFAULT_PORTAL_DEFAULT_BRANCH, PermissionAction, PortalOperation, SecurityMode } from "@exaix/core";

// ============================================================================
// Permission Check Interfaces
// ============================================================================

/**
 * Result of a permission check
 */
export interface IPermissionCheckResult {
  allowed: boolean;
  reason?: string;
  portal: string;
  identity_id: string;
  operation: PortalOperation;
}

/**
 * Result of enhanced RBAC permission check
 */
export interface IRBACPermissionCheckResult {
  allowed: boolean;
  reason?: string;
  portal: string;
  identity_id: string;
  action: PermissionAction;
  resource: string;
  conditions?: {
    timeWindow?: { start: string; end: string };
    ipWhitelist?: string[];
    maxOperations?: number;
  };
}

/**
 * Result of agent whitelist check
 */
export interface IAgentWhitelistResult {
  allowed: boolean;
  reason?: string;
  portal: string;
  identity_id: string;
}

// ============================================================================
// Security Modes
// ============================================================================

/**
 * Security mode for agent execution:
 * - sandboxed: No file system access, all operations via MCP tools
 * - hybrid: Read-only portal access, writes via MCP tools with audit
 */
export const SecurityModeSchema = z.nativeEnum(SecurityMode);

/**
 * Operations that can be permitted on a portal
 */
export const PortalOperationSchema = z.nativeEnum(PortalOperation);

// ============================================================================
// Enhanced Permission Model
// ============================================================================

/**
 * Permission action types
 */
export const PermissionActionSchema = z.nativeEnum(PermissionAction);

/**
 * Permission conditions for fine-grained access control
 */
export const PermissionConditionsSchema = z.object({
  timeWindow: z.object({
    start: z.string(), // HH:MM format (e.g., "09:00")
    end: z.string(), // HH:MM format (e.g., "17:00")
  }).optional(),
  ipWhitelist: z.array(z.string()).optional(), // CIDR notation supported
  maxOperations: z.number().positive().optional(),
}).optional();

export type IPermissionConditions = z.infer<typeof PermissionConditionsSchema>;

/**
 * Enhanced permission with resource/action/condition model
 */
export const PermissionSchema = z.object({
  resource: z.string(), // Resource pattern (e.g., "/portal/*", "/portal/project")
  action: z.union([
    PermissionActionSchema,
    z.array(PermissionActionSchema),
  ]), // Single action or array of actions
  conditions: PermissionConditionsSchema,
});

export type IPermission = z.infer<typeof PermissionSchema>;

// ============================================================================
// Portal Security Configuration
// ============================================================================

/**
 * Security settings for a portal
 */
export const PortalSecurityConfigSchema = z.object({
  mode: SecurityModeSchema.default(SecurityMode.SANDBOXED),
  audit_enabled: z.boolean().default(true),
  log_all_actions: z.boolean().default(true),
});

export type IPortalSecurityConfig = z.infer<typeof PortalSecurityConfigSchema>;

/**
 * Extended portal configuration with permissions
 */
export const PortalPermissionsSchema = z.object({
  alias: z.string(),
  target_path: z.string(),
  description: z.string().optional(),
  default_branch: z.string().default(DEFAULT_PORTAL_DEFAULT_BRANCH),
  created: z.string().optional(),

  // Legacy permission controls (for backward compatibility)
  identities_allowed: z.array(z.string()).default(["*"]), // "*" = all agents
  operations: z.array(PortalOperationSchema).default([
    PortalOperation.READ,
    PortalOperation.WRITE,
    PortalOperation.GIT,
  ]),

  // Enhanced RBAC permissions
  permissions: z.array(PermissionSchema).optional(),

  // Security settings
  security: PortalSecurityConfigSchema.optional(),
});

export type IPortalPermissions = z.output<typeof PortalPermissionsSchema>;
export type IPortalPermissionsInput = z.input<typeof PortalPermissionsSchema>;
