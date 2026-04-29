/**
 * @module PortalCommands
 * @path src/cli/commands/portal_commands.ts
 * @description Provides CLI commands for managing portals, delegating business logic to PortalService.
 * @architectural-layer CLI
 * @related-files [src/services/portal.ts, src/shared/interfaces/i_portal_service.ts]
 */

import { BaseCommand, type ICommandContext } from "../base.ts";
import type { PortalAnalysisMode, PortalExecutionStrategy } from "@exaix/core";
import type { IPortalDetails, IPortalInfo, IVerificationResult } from "@exaix/core/types/portal.ts";
import { formatKnowledge } from "../../shared/formatters/portal_knowledge.ts";

/**
 * CLI command handler for portal operations.
 * Delegates all business logic to the core PortalService.
 */
export class PortalCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  /**
   * Add a new portal
   */
  async add(
    targetPath: string,
    alias: string,
    options?: { defaultBranch?: string; executionStrategy?: PortalExecutionStrategy },
  ): Promise<void> {
    return await this.portals.add(targetPath, alias, options);
  }

  /**
   * List all portals with their status
   */
  async list(): Promise<IPortalInfo[]> {
    return await this.portals.list();
  }

  /**
   * Show detailed information about a specific portal
   */
  async show(alias: string): Promise<IPortalDetails> {
    return await this.portals.show(alias);
  }

  /**
   * Remove a portal
   */
  async remove(alias: string, options?: { keepCard?: boolean }): Promise<void> {
    return await this.portals.remove(alias, options);
  }

  /**
   * Verify portal integrity
   */
  async verify(alias?: string): Promise<IVerificationResult[]> {
    return await this.portals.verify(alias);
  }

  /**
   * Refresh context card for a portal
   */
  async refresh(alias: string): Promise<void> {
    return await this.portals.refresh(alias);
  }

  /**
   * Trigger codebase knowledge analysis for a portal.
   * Returns a human-readable summary of the analysis.
   */
  async analyze(
    alias: string,
    options?: { mode?: PortalAnalysisMode; force?: boolean },
  ): Promise<string> {
    return await this.portals.analyze(alias, options);
  }

  /**
   * Display gathered knowledge for a portal.
   * Returns formatted Markdown by default, or raw JSON with `--json`.
   */
  async knowledge(
    alias: string,
    options?: { json?: boolean },
  ): Promise<string> {
    const data = await this.portals.getKnowledge(alias);

    if (!data) {
      return `No knowledge available for '${alias}'.\nRun \`exactl portal analyze ${alias}\` to gather it.`;
    }

    if (options?.json) {
      return JSON.stringify(data, null, 2);
    }

    return formatKnowledge(data).join("\n");
  }
}
