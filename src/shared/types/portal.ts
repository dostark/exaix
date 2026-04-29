/**
 * @module Portal
 * @path src/shared/types/portal.ts
 * @description Module for Portal.
 * @architectural-layer Shared
 * @related-files [src/shared/interfaces/i_portal_service.ts]
 */

import type { PortalExecutionStrategy, PortalStatus, VerificationStatus } from "@exaix/core";

/**
 * Basic information about a portal.
 */
export interface IPortalInfo {
  alias: string;
  targetPath: string;
  symlinkPath: string;
  contextCardPath: string;
  status: PortalStatus;
  created?: string;
  lastVerified?: string;
  defaultBranch?: string;
  executionStrategy?: PortalExecutionStrategy;
}

/**
 * Detailed information about a specific portal.
 */
export interface IPortalDetails extends IPortalInfo {
  permissions?: string;
  // Add other details if needed by TUI
}

/**
 * Result of a portal integrity verification.
 */
export interface IVerificationResult {
  alias: string;
  status: VerificationStatus;
  issues?: string[];
}
