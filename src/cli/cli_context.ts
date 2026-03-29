/**
 * @module CliContext
 * @path src/cli/cli_context.ts
 * @description Defines the ICliApplicationContext interface used by CLI commands.
 * @architectural-layer CLI
 * @dependencies [shared_interfaces, ai_types]
 * @related-files [src/cli/commands/, src/cli/main.ts]
 */

import type { IDatabaseService } from "../shared/interfaces/i_database_service.ts";
import type { IModelProvider } from "../ai/types.ts";
import type { IGitService } from "../shared/interfaces/i_git_service.ts";
import type { IDisplayService } from "../shared/interfaces/i_display_service.ts";
import type { IConfigService } from "../shared/interfaces/i_config_service.ts";
import type { IMemoryService } from "../shared/interfaces/i_memory_service.ts";
import type { IMemoryBankService } from "../shared/interfaces/i_memory_bank_service.ts";
import type { IMemoryExtractorService } from "../shared/interfaces/i_memory_extractor_service.ts";
import type { IMemoryEmbeddingService } from "../shared/interfaces/i_memory_embedding_service.ts";
import type { IArchiveService } from "../shared/interfaces/i_archive_service.ts";
import type { IFlowValidatorService } from "../shared/interfaces/i_flow_validator_service.ts";
import type { IContextCardGeneratorService } from "../shared/interfaces/i_context_card_generator_service.ts";
import type { ISkillsService } from "../shared/interfaces/i_skills_service.ts";
import type { IPortalService } from "../shared/interfaces/i_portal_service.ts";
import type { IRequestService } from "../shared/interfaces/i_request_service.ts";
import type { IPlanService } from "../shared/interfaces/i_plan_service.ts";
import type { IToolRegistry } from "../shared/interfaces/i_tool_registry.ts";
import type {
  IPortalKnowledgeConfig,
  IPortalKnowledgeService,
} from "../shared/interfaces/i_portal_knowledge_service.ts";

export interface ICliApplicationContext {
  db: IDatabaseService;
  provider: IModelProvider;
  git: IGitService;
  display: IDisplayService;
  config: IConfigService;
  toolRegistry?: IToolRegistry;
  memory?: IMemoryService;
  memoryBank?: IMemoryBankService;
  extractor?: IMemoryExtractorService;
  embeddings?: IMemoryEmbeddingService;
  archive?: IArchiveService;
  flowValidator?: IFlowValidatorService;
  contextCards?: IContextCardGeneratorService;
  skills?: ISkillsService;
  portals?: IPortalService;
  requests?: IRequestService;
  plans?: IPlanService;
  portalKnowledge?: IPortalKnowledgeService;
  portalKnowledgeConfig?: IPortalKnowledgeConfig;
}

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
};
