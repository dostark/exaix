/**
 * @module IportalService
 * @path packages/core/src/types/i_portal_service.ts
 * @description Module for IportalService.
 * @architectural-layer Shared
 * @related-files [@exaix/core/types]
 */

import type { PortalAnalysisMode, PortalExecutionStrategy } from "@exaix/core/types";
import type { IPortalDetails, IPortalInfo, IVerificationResult } from "@exaix/core";

import type { IPortalKnowledge } from "@exaix/schemas";

export interface IPortalService {
  /**
   * Add a new portal.
   */
  add(
    targetPath: string,
    alias: string,
    options?: { defaultBranch?: string; executionStrategy?: PortalExecutionStrategy },
  ): Promise<void>;

  /**
   * List all portals.
   */
  list(): Promise<IPortalInfo[]>;

  /**
   * Alias for list() for TUI compatibility.
   */
  listPortals(): Promise<IPortalInfo[]>;

  /**
   * Show details of a portal.
   */
  show(alias: string): Promise<IPortalDetails>;

  /**
   * Alias for show() for TUI compatibility.
   */
  getPortalDetails(alias: string): Promise<IPortalDetails>;

  /**
   * Remove a portal.
   */
  remove(alias: string, options?: { keepCard?: boolean }): Promise<void>;

  /**
   * Alias for remove() for TUI compatibility.
   */
  removePortal(alias: string, options?: { keepCard?: boolean }): Promise<boolean>;

  /**
   * Verify portal integrity.
   */
  verify(alias?: string): Promise<IVerificationResult[]>;

  /**
   * Refresh the context card for a portal.
   */
  refresh(alias: string): Promise<void>;

  /**
   * Alias for refresh() for TUI compatibility.
   */
  refreshPortal(alias: string): Promise<boolean>;

  /**
   * TUI-specific: Open a portal (e.g., in an editor or focused view).
   */
  openPortal(alias: string): Promise<boolean>;

  /**
   * TUI-specific: Close a portal.
   */
  closePortal(alias: string): Promise<boolean>;

  /**
   * TUI-specific: Get the filesystem path for a portal.
   */
  getPortalFilesystemPath(alias: string): Promise<string>;

  /**
   * TUI-specific: Quick jump to a portal directory.
   */
  quickJumpToPortalDir(alias: string): Promise<string>;

  /**
   * TUI-specific: Get the activity log for a portal.
   */
  getPortalActivityLog(alias: string): string[];

  /**
   * Load persisted portal knowledge from knowledge.json, or null when not yet analyzed.
   */
  getKnowledge(portalAlias: string): Promise<IPortalKnowledge | null>;

  /**
   * Trigger codebase knowledge analysis for a portal.
   * Returns a human-readable summary of the analysis.
   */
  analyze(
    alias: string,
    options?: { mode?: PortalAnalysisMode; force?: boolean },
  ): Promise<string>;
}
