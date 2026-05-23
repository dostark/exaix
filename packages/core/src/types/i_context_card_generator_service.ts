/**
 * @module IContextCardGeneratorService
 * @path packages/core/src/types/i_context_card_generator_service.ts
 * @description Interface for context card generation services.
 * @architectural-layer Shared
 * @related-files [apps/common/adapters/context_card_adapter.ts, packages/cli/src/types/cli_context.ts]
 */

export interface IContextCardOptions {
  includeEnvironment?: boolean;
  includeArchitecture?: boolean;
  includeRecentActivity?: boolean;
  maxEntries?: number;
}

export interface IContextCardPortalInfo {
  alias: string;
  path: string;
  techStack: string[];
}

export interface IContextCardGeneratorService {
  /**
   * Generate a context card for a portal.
   */
  generate(portal: IContextCardPortalInfo): Promise<void>;
}
