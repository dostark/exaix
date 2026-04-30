/**
 * @module CliContext
 * @path src/cli/cli_context.ts
 * @description Defines the ICliApplicationContext interface used by CLI commands.
 * @architectural-layer CLI
 * @related-files [src/cli/commands/, "src/main.ts"]
 */

import type { IApplicationContext } from "@exaix/core/types";
/**
 * Interface that defines the CLI-specific application context.
 * Inherits from IApplicationContext but can be extended with CLI-specific services.
 */
export interface ICliApplicationContext extends IApplicationContext {}

export type {
  IArchiveService,
  IContextCardGeneratorService,
  ICostTracker,
  IFlowValidatorService,
  IMemoryBankService,
  IMemoryEmbeddingService,
  IMemoryExtractorService,
  IMemoryService,
  IPlanService,
  IPortalKnowledgeConfig,
  IPortalKnowledgeService,
  IPortalService,
  IRequestService,
  ISkillsService,
  IToolRegistry,
} from "@exaix/core/types";
