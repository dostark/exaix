/**
 * @module IContextCardGeneratorService
 * @path src/shared/interfaces/i_context_card_generator_service.ts
 * @description Interface for context card generation services.
 * @architectural-layer Shared
 * @related-files [src/services/adapters/context_card_adapter.ts, apps/exactl/src/cli_context.ts]
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
