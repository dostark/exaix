/**
 * @module MemoryPackage
 * @path packages/memory/mod.ts
 * @related-files []
 * @architectural-layer Memory
 * @description Package entrypoint for @exaix/memory — memory bank services,
 * embedding/search, extraction, session memory, and auto-approval.
 */
export { MemoryBankService } from "./src/bank/memory_bank.ts";
export {
  calculateFrequency,
  calculateRelevance,
  type ISearchDeps,
  searchByKeyword,
  searchByTags,
  searchMemory,
  searchMemoryAdvanced,
} from "./src/bank/memory_search.ts";
export { parseDecisions, parsePatterns } from "./src/bank/parsers.ts";
export { formatExecutionSummary } from "./src/bank/formatters.ts";
export { buildFilesIndex, buildPatternsIndex, buildTagsIndex, writeIndices } from "./src/bank/index_builder.ts";

export { cosineSimilarity, generateMockEmbedding, MemoryEmbeddingService } from "./src/embedding/memory_embedding.ts";
export type { IEmbeddingSearchResult } from "./src/embedding/memory_embedding.ts";
export { HnswVectorIndex } from "./src/embedding/vector_index.ts";
export type { IVectorIndexEntry, IVectorIndexSnapshot } from "./src/embedding/vector_index.ts";
export { ProviderEmbeddingService } from "./src/embedding/provider_embedding_service.ts";

export { MemoryExtractorService } from "./src/extraction/memory_extractor.ts";
export { LearningExtractor } from "./src/extraction/learning_extractor.ts";
export { HeuristicExtractionStrategy } from "./src/extraction/heuristic_extraction_strategy.ts";
export { LlmLearningExtractor } from "./src/extraction/llm_learning_extractor.ts";
export { LearningContradictionResolver } from "./src/contradiction/learning_contradiction_resolver.ts";
export { findDedupMatch, mergeLearnings } from "./src/dedup/semantic_dedup.ts";
export type { IDedupCandidate } from "./src/dedup/semantic_dedup.ts";
export { computeRecencyFactor, rankByTemporalRelevance } from "./src/temporal/temporal_scoring.ts";
export type { ITemporalCandidate, ITemporalScoringOptions } from "./src/temporal/temporal_scoring.ts";
export { fuseHybridScores } from "./src/hybrid/hybrid_fusion.ts";
export {
  chunkEmbeddingId,
  embeddableId,
  embeddableTextChunks,
  embeddableTitle,
  LEGACY_EMBEDDING_KIND,
  overviewEmbeddingId,
} from "./src/embedding/embeddable_entry.ts";

export {
  DEFAULT_SESSION_MEMORY_CONFIG,
  EnhancedRequestSchema,
  InsightSchema,
  MemoryItemSchema,
  SaveInsightResultSchema,
  SessionMemoryConfigSchema,
  SessionMemoryService,
} from "./src/session/session_memory.ts";
export type {
  EnhancedRequest,
  Insight,
  MemoryItem,
  SaveInsightResult,
  SessionMemoryConfig,
} from "./src/session/session_memory.ts";

export { MemoryAutoApprovalService } from "./src/approval/memory_auto_approval_service.ts";
export type {
  IAutoApprovalResult,
  IEligibleMemoryUpdateProposal,
} from "./src/approval/memory_auto_approval_service.ts";
export { initializeMemoryAutoApprovalMaintenance } from "./src/approval/auto_approval_daemon.ts";
export { MemoryReflectionService } from "./src/reflection/memory_reflection_service.ts";
export { ScratchpadService } from "./src/scratchpad/scratchpad_service.ts";
export type {
  IMemoryReflectionServiceDeps,
  IReflectionCycleResult,
} from "./src/reflection/memory_reflection_service.ts";
