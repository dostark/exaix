/**
 * @module PortalKnowledgeSubpackage
 * @path packages/portal/knowledge/mod.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Barrel for @exaix/portal/knowledge subpackage — portal analysis,
 * inference, persistence, and knowledge service.
 */

export { analyzeDirectory, type IWalkResult, walkDirectory } from "./directory_analyzer.ts";
export { type IConfigParseResult, parseConfigFiles } from "./config_parser.ts";
export { identifyKeyFiles } from "./key_file_identifier.ts";
export { detectPatterns } from "./pattern_detector.ts";
export {
  type IDenoDocFunctionDef,
  type IDenoDocJsDoc,
  type IDenoDocLocation,
  type IDenoDocNode,
  type IDenoDocParam,
  type IDenoDocReturnType,
  type IDenoDocVariableDef,
  type IDocCommandRunner,
  type ISymbolExtractorOptions,
  SymbolExtractor,
} from "./symbol_extractor.ts";
export { loadKnowledge, saveKnowledge } from "./knowledge_persistence.ts";
export { GitHeadResolver } from "./git_head_resolver.ts";
export type { IGitHeadResolver } from "./git_head_resolver.ts";
export { ArchitectureInferrer } from "./architecture_inferrer.ts";
export type { IArchitectureInferrerInput, IArchitectureValidator } from "./architecture_inferrer.ts";
export { KnowledgeInvalidationStrategy } from "./knowledge_invalidation_strategy.ts";
export type {
  IKnowledgeInvalidationStrategy,
  IKnowledgeValidityCheck,
  KnowledgeAnalysisMode,
  KnowledgeValidityReason,
} from "./knowledge_invalidation_strategy.ts";
export { PortalKnowledgeService } from "./portal_knowledge_service.ts";
export type { IPortalKnowledgeServiceOptions } from "./portal_knowledge_service.ts";
