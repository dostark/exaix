/**
 * @module PortalKnowledgeModule
 * @path src/services/portal_knowledge/mod.ts
 * @description Barrel file for the portal_knowledge service module.
 * Re-exports all public classes, interfaces, and utilities used by consumers
 * of the portal knowledge gathering subsystem (Phase 46).
 * @architectural-layer Services
 * @related-files ["packages/core/src/types/i_portal_knowledge_service.ts", "packages/schemas/src/portal_knowledge.ts"]
 */

export { PortalKnowledgeService } from "./portal_knowledge_service.ts";
export { loadKnowledge, saveKnowledge } from "./knowledge_persistence.ts";
export {
  ArchitectureInferrer,
  type IArchitectureInferrerInput,
  type IArchitectureValidator,
} from "./architecture_inferrer.ts";
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
export { analyzeDirectory, type IWalkResult, walkDirectory } from "./directory_analyzer.ts";
export { parseConfigFiles } from "./config_parser.ts";
export { identifyKeyFiles } from "./key_file_identifier.ts";
export { detectPatterns } from "./pattern_detector.ts";
export { GitHeadResolver, type IGitHeadResolver } from "./git_head_resolver.ts";
export {
  type IKnowledgeInvalidationStrategy,
  type IKnowledgeValidityCheck,
  KnowledgeInvalidationStrategy,
} from "./knowledge_invalidation_strategy.ts";
