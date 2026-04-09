/**
 * @module PortalAdapter
 * @path src/services/adapters/portal_adapter.ts
 * @description Module for PortalAdapter.
 * @architectural-layer Services
 * * @related-files [src/cli/commands/portal_commands.ts, src/shared/interfaces/i_portal_service.ts]
 */

import type { PortalService } from "../portal/portal.ts";
import type { IPortalService } from "../../shared/interfaces/i_portal_service.ts";
import type { IPortalDetails, IPortalInfo, IVerificationResult } from "../../shared/types/portal.ts";
import type { PortalAnalysisMode, PortalExecutionStrategy } from "../../shared/enums.ts";
import type { IPortalKnowledge } from "../../shared/schemas/portal_knowledge.ts";

export class PortalAdapter implements IPortalService {
  constructor(private service: PortalService) {}

  async add(
    targetPath: string,
    alias: string,
    options?: { defaultBranch?: string; executionStrategy?: PortalExecutionStrategy },
  ): Promise<void> {
    await this.service.add(targetPath, alias, options);
  }

  async list(): Promise<IPortalInfo[]> {
    return await this.service.list();
  }

  async listPortals(): Promise<IPortalInfo[]> {
    return await this.list();
  }

  async show(alias: string): Promise<IPortalDetails> {
    return await this.service.show(alias);
  }

  async getPortalDetails(alias: string): Promise<IPortalDetails> {
    return await this.show(alias);
  }

  async remove(alias: string, options?: { keepCard?: boolean }): Promise<void> {
    await this.service.remove(alias, options);
  }

  async removePortal(alias: string, options?: { keepCard?: boolean }): Promise<boolean> {
    try {
      await this.remove(alias, options);
      return true;
    } catch {
      return false;
    }
  }

  async verify(alias?: string): Promise<IVerificationResult[]> {
    return await this.service.verify(alias);
  }

  async refresh(alias: string): Promise<void> {
    await this.service.refresh(alias);
  }

  async refreshPortal(alias: string): Promise<boolean> {
    try {
      await this.refresh(alias);
      return true;
    } catch {
      return false;
    }
  }

  openPortal(_alias: string): Promise<boolean> {
    // TUI-specific stub
    return Promise.resolve(true);
  }

  closePortal(_alias: string): Promise<boolean> {
    // TUI-specific stub
    return Promise.resolve(true);
  }

  async getPortalFilesystemPath(alias: string): Promise<string> {
    const details = await this.show(alias);
    return details.targetPath;
  }

  async quickJumpToPortalDir(alias: string): Promise<string> {
    return await this.getPortalFilesystemPath(alias);
  }

  getPortalActivityLog(_alias: string): string[] {
    return ["Portal activity log not yet implemented in adapter."];
  }

  getKnowledge(alias: string): Promise<IPortalKnowledge | null> {
    return this.service.getKnowledge(alias);
  }

  async analyze(
    alias: string,
    options?: { mode?: PortalAnalysisMode; force?: boolean },
  ): Promise<string> {
    return await this.service.analyze(alias, options);
  }
}
