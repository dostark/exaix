/**
 * @module CliContext
 * @path src/cli/cli_context.ts
 * @description Defines the ICliApplicationContext interface used by CLI commands.
 * @architectural-layer CLI
 * * @related-files [src/cli/commands/, src/cli/main.ts]
 */

import type { IApplicationContext } from "../shared/interfaces/i_application_context.ts";

/**
 * Interface that defines the CLI-specific application context.
 * Inherits from IApplicationContext but can be extended with CLI-specific services.
 */
export interface ICliApplicationContext extends IApplicationContext {}

export type {
  IArchiveService,
  IContextCardGeneratorService,
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
} from "../shared/interfaces/i_application_context.ts";
