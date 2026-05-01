/**
 * @module IApplicationContext
 * @path src/shared/interfaces/i_application_context.ts
 * @description Defines the core application context for dependency injection across the system.
 * This is a generic interface that can be used by CLI, TUI, and core services.
 * @architectural-layer Shared/Interfaces
 * @related-files ["packages/core/src/types/i_config_service.ts", @exaix/core/types/i_database_service.ts, packages/core/src/logger/event_logger.ts]
 */

import type { IDatabaseService } from "./i_database_service.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGitService } from "./i_git_service.ts";
import type { IDisplayService } from "./i_display_service.ts";
import type { IConfigService } from "./i_config_service.ts";
import type { IMemoryService } from "./i_memory_service.ts";
import type { IMemoryBankService } from "./i_memory_bank_service.ts";
import type { IMemoryExtractorService } from "./i_memory_extractor_service.ts";
import type { IMemoryEmbeddingService } from "./i_memory_embedding_service.ts";
import type { IArchiveService } from "./i_archive_service.ts";
import type { IFlowValidatorService } from "./i_flow_validator_service.ts";
import type { IContextCardGeneratorService } from "./i_context_card_generator_service.ts";
import type { ISkillsService } from "./i_skills_service.ts";
import type { IPortalService } from "./i_portal_service.ts";
import type { IRequestService } from "./i_request_service.ts";
import type { IPlanService } from "./i_plan_service.ts";
import type { IPlanAmendmentService } from "./i_plan_amendment_service.ts";
import type { IToolRegistry } from "./i_tool_registry.ts";
import type { IGateEvaluator } from "./i_gate_evaluator.ts";
import type { IPortalKnowledgeConfig, IPortalKnowledgeService } from "./i_portal_knowledge_service.ts";
import type { ICostTracker } from "./i_cost_tracker.ts";

/**
 * Generic application context for dependency injection
 */
export interface IApplicationContext {
  /** Master configuration service */
  config: IConfigService;

  /** Persistence service */
  db: IDatabaseService;

  /** AI model provider */
  provider: IModelProvider;

  /** Git orchestration service */
  git: IGitService;

  /** UI/Console display and logging service */
  display: IDisplayService;

  /** Optional tool registry for MCP/tool execution */
  toolRegistry?: IToolRegistry;

  /** Optional memory service for knowledge management */
  memory?: IMemoryService;

  /** Optional memory bank for direct access */
  memoryBank?: IMemoryBankService;

  /** Optional logic for extracting insights into memory */
  extractor?: IMemoryExtractorService;

  /** Optional service for vector embeddings */
  embeddings?: IMemoryEmbeddingService;

  /** Optional archival service */
  archive?: IArchiveService;

  /** Optional validation for agent flows */
  flowValidator?: IFlowValidatorService;

  /** Optional visual context card generation */
  contextCards?: IContextCardGeneratorService;

  /** Optional skill management service */
  skills?: ISkillsService;

  /** Optional portal management service */
  portals?: IPortalService;

  /** Optional request tracking service */
  requests?: IRequestService;

  /** Optional plan management service */
  plans?: IPlanService;

  /** Optional plan amendment service */
  amendments?: IPlanAmendmentService;

  /** Optional quality gate evaluator */
  gateEvaluator?: IGateEvaluator;

  /** Optional portal knowledge analysis service */
  portalKnowledge?: IPortalKnowledgeService;

  /** Configuration for portal knowledge analysis */
  portalKnowledgeConfig?: IPortalKnowledgeConfig;

  /** Optional cost and token tracking service */
  cost?: ICostTracker;
}

// Re-export types for convenience
export type {
  IArchiveService,
  IConfigService,
  IContextCardGeneratorService,
  ICostTracker,
  IDatabaseService,
  IDisplayService,
  IFlowValidatorService,
  IGateEvaluator,
  IGitService,
  IMemoryBankService,
  IMemoryEmbeddingService,
  IMemoryExtractorService,
  IMemoryService,
  IPlanAmendmentService,
  IPlanService,
  IPortalKnowledgeConfig,
  IPortalKnowledgeService,
  IPortalService,
  IRequestService,
  ISkillsService,
  IToolRegistry,
};
