/**
 * @module PortalKnowledgeSubpackage
 * @path packages/portal/knowledge/mod.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Barrel for @exaix/portal/knowledge subpackage — portal analysis,
 * inference, persistence, and knowledge service.
 */

export { MODULE_DEPENDENCY_EDGE_KIND } from "@exaix/core";
export { TreeSitterSymbolExtractor } from "./tree_sitter_symbol_extractor.ts";
export { PythonSymbolExtractor } from "./python_symbol_extractor.ts";
export * from "./symbol_extraction_constants.ts";
export { analyzeDirectory } from "./directory_analyzer.ts";
export { parseConfigFiles } from "./config_parser.ts";
export { identifyKeyFiles } from "./key_file_identifier.ts";
export { computeAdaptiveSampleSize, detectPatterns, selectSampleFiles } from "./pattern_detector.ts";
export {
  type IDenoDocNode,
  type IDocCommandRunner,
  type ISymbolExtractor,
  type ISymbolExtractorOptions,
  SymbolExtractor,
} from "./symbol_extractor.ts";
export {
  createDefaultSymbolExtractorRegistry,
  type ISymbolExtractorRegistry,
  SymbolExtractorRegistry,
} from "./symbol_extractor_registry.ts";
export { loadKnowledge, saveKnowledge } from "./knowledge_persistence.ts";
export { buildPortalKnowledgeConfig } from "./portal_knowledge_config.ts";
export {
  createDefaultSymbolFileResolverRegistry,
  createDefaultSymbolReferenceExtractorRegistry,
  EMPTY_SYMBOL_REFERENCE_EXTRACTOR,
  type ISymbolFileResolverRegistry,
  type ISymbolReferenceExtractor,
  type ISymbolReferenceExtractorOptions,
  type ISymbolReferenceExtractorRegistry,
} from "./symbol_reference_extractor.ts";
export { GitHeadResolver } from "./git_head_resolver.ts";
export type { IGitHeadResolver } from "./git_head_resolver.ts";
export { InternalImportGraphBuilder } from "./internal_import_graph.ts";
export {
  decodeSymbolRef,
  encodeSymbolRef,
  mergeRelationships,
  queryRelationships,
  traverseModuleDependencies,
  whoDependsOn,
} from "./relationship_query.ts";
export type { IPersistedRelationshipEdge, RelationshipEdgeKind } from "./relationship_query.ts";
export { ArchitectureInferrer } from "./architecture_inferrer.ts";
export type { IArchitectureValidator } from "./architecture_inferrer.ts";
export { KnowledgeInvalidationStrategy } from "./knowledge_invalidation_strategy.ts";
export type { IKnowledgeInvalidationStrategy, IKnowledgeValidityCheck } from "./knowledge_invalidation_strategy.ts";
export { PortalKnowledgeService } from "./portal_knowledge_service.ts";
export type { IPortalKnowledgeServiceOptions } from "./portal_knowledge_service.ts";
