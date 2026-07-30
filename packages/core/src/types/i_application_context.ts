/**
 * @module IApplicationContext
 * @path packages/core/src/types/i_application_context.ts
 * @description Defines the core application context for dependency injection across the system.
 * This is a generic interface that can be used by CLI, TUI, and core services.
 * @architectural-layer Shared/Interfaces
 * @related-files ["packages/core/src/types/i_config_service.ts", @exaix/core/types, packages/core/src/logger/event_logger.ts]
 */

import type { IDatabaseService } from "./i_database_service.ts";
import type { IModelProvider } from "@exaix/ai";

import type { IGitService } from "./i_git_service.ts";
import type { IGitServiceFactory } from "./i_git_service_factory.ts";
import type { IDisplayService } from "./i_display_service.ts";
import type { IConfigService } from "./i_config_service.ts";
import type { IMemoryService } from "./i_memory_service.ts";
import type { IMemoryBankService } from "./i_memory_bank_service.ts";
import type { IMemoryExtractorService } from "./i_memory_extractor_service.ts";
import type { IMemoryEmbeddingService } from "./i_memory_embedding_service.ts";
import type { IArchiveService } from "./i_archive_service.ts";
import type { IFlowValidatorService } from "./i_flow_validator_service.ts";
import type { IFlowLoaderService } from "./i_flow_loader_service.ts";
import type { IContextCardGeneratorService } from "./i_context_card_generator_service.ts";
import type { ISkillsService } from "./i_skills_service.ts";
import type { IPortalService } from "./i_portal_service.ts";
import type { IRequestService } from "./i_request_service.ts";
import type { IPlanService } from "./i_plan_service.ts";
import type { IPlanAmendmentService } from "./i_plan_amendment_service.ts";
import type { IToolRegistry } from "./i_tool_registry.ts";
import type { IGateEvaluator } from "./i_gate_evaluator.ts";
import type { IConfigAdapter } from "./i_config_adapter.ts";
import type { IPortalKnowledgeConfig, IPortalKnowledgeService } from "./i_portal_knowledge_service.ts";
import type { ICostTracker } from "./i_cost_tracker.ts";
import type { INotificationService } from "./i_notification_service.ts";
import type { IBenchmarkReader, IModelRegistry } from "./i_model_registry.ts";

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

  /**
   * Optional git service factory for per-portal GitService construction.
   * Set by composition roots (daemon, MCP server) that need per-call git
   * instances. Handlers access git through this factory, never `context.git`
   * directly. A missing factory produces a detectable error.
   */
  gitServiceFactory?: IGitServiceFactory;

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
  flowLoader?: IFlowLoaderService;

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

  /** Optional notification service for human-in-the-loop and TUI/daemon flows */
  notificationService?: INotificationService;

  /** Optional config adapter for reading/writing config via the daemon's in-memory store */
  configAdapter?: IConfigAdapter;

  /** Optional model registry (Solo floor) for CLI model display + curation commands */
  modelRegistry?: IModelRegistry;

  /**
   * Phase 135 Step 8 (§5.8.5) — optional advisory benchmark-score reader for
   * `exactl models list --benchmark`. Wired only for Team editions (init.ts
   * constructs a ModelRegistryService); absent in Solo (the CLI renders "-").
   */
  benchmarkReader?: IBenchmarkReader;
}

// Re-export types for convenience
export type {
  IArchiveService,
  IConfigService,
  IContextCardGeneratorService,
  ICostTracker,
  IDisplayService,
  IFlowValidatorService,
  IGateEvaluator,
  IGitService,
  IMemoryBankService,
  IMemoryEmbeddingService,
  IMemoryExtractorService,
  IMemoryService,
  INotificationService,
  IPlanAmendmentService,
  IPlanService,
  IPortalKnowledgeConfig,
  IPortalKnowledgeService,
  IPortalService,
  IRequestService,
  ISkillsService,
  IToolRegistry,
};
