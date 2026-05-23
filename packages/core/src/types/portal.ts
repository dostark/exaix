/**
 * @module Portal
 * @path packages/core/src/types/portal.ts
 * @description Module for Portal.
 * @architectural-layer Shared
 * @related-files ["packages/core/src/types/i_portal_service.ts"]
 */

import type { VerificationStatus } from "@exaix/core";

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

export enum PortalOperation {
  READ = "read",
  WRITE = "write",
  GIT = "git",
}

export enum PortalExecutionStrategy {
  BRANCH = "branch",
  WORKTREE = "worktree",
}

export enum PortalAnalysisMode {
  QUICK = "quick",
  STANDARD = "standard",
  DEEP = "deep",
}

export enum PortalStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  BROKEN = "broken",
}
