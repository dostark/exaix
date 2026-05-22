/**
 * @module CliContext
 * @path packages/cli/src/types/cli_context.ts
 * @description Defines the ICliApplicationContext interface used by CLI commands.
 * @architectural-layer CLI
 */

import type { IApplicationContext } from "@exaix/core/types";

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
