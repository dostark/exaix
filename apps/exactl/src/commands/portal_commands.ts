/**
 * @module PortalCommands
 * @path apps/exactl/src/commands/portal_commands.ts
 * @description Provides CLI commands for managing portals, delegating business logic to PortalService.
 * @architectural-layer CLI
 * @related-files ["packages/portal/src/portal.ts", "packages/core/src/types/i_portal_service.ts"]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import type { PortalAnalysisMode, PortalExecutionStrategy } from "@exaix/core";
import type { IPortalDetails, IPortalInfo, IVerificationResult, Opt, Reason } from "@exaix/core/types";
import { formatKnowledge } from "@exaix/cli/formatters/portal_knowledge.ts";

/** CLI command handler for portal operations; delegates business logic to PortalService. */
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
    options?: Opt<
      { defaultBranch?: string; executionStrategy?: PortalExecutionStrategy },
      Reason.OptionalInput
    >,
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
  async remove(alias: string, options?: Opt<{ keepCard?: boolean }, Reason.OptionalInput>): Promise<void> {
    return await this.portals.remove(alias, options);
  }

  /**
   * Verify portal integrity
   */
  async verify(alias?: Opt<string, Reason.OptionalInput>): Promise<IVerificationResult[]> {
    return await this.portals.verify(alias);
  }

  /**
   * Refresh context card for a portal
   */
  async refresh(alias: string): Promise<void> {
    return await this.portals.refresh(alias);
  }

  /** Triggers codebase knowledge analysis for a portal; returns a human-readable summary. */
  async analyze(
    alias: string,
    options?: Opt<{ mode?: PortalAnalysisMode; force?: boolean }, Reason.OptionalInput>,
  ): Promise<string> {
    return await this.portals.analyze(alias, options);
  }

  /** Returns formatted Markdown by default, or raw JSON when `options.json` is set. */
  async knowledge(
    alias: string,
    options?: Opt<{ json?: boolean }, Reason.OptionalInput>,
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
