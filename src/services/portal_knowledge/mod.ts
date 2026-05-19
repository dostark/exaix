/**
 * @module PortalKnowledgeModule
 * @path src/services/portal_knowledge/mod.ts
 * @description Barrel file for the portal_knowledge service module.
 * All sources have been migrated to @exaix/portal. This barrel re-exports for compatibility.
 * @architectural-layer Services
 * @related-files ["packages/core/src/types/i_portal_knowledge_service.ts", "packages/schemas/src/portal_knowledge.ts"]
 */

export {
  analyzeDirectory,
  ArchitectureInferrer,
  detectPatterns,
  GitHeadResolver,
  type IArchitectureInferrerInput,
  type IArchitectureValidator,
  type IDenoDocFunctionDef,
  type IDenoDocJsDoc,
  type IDenoDocLocation,
  type IDenoDocNode,
  type IDenoDocParam,
  type IDenoDocReturnType,
  type IDenoDocVariableDef,
  identifyKeyFiles,
  type IDocCommandRunner,
  type IGitHeadResolver,
  type IKnowledgeInvalidationStrategy,
  type IKnowledgeValidityCheck,
  type ISymbolExtractorOptions,
  type IWalkResult,
  KnowledgeInvalidationStrategy,
  loadKnowledge,
  parseConfigFiles,
  PortalKnowledgeService,
  saveKnowledge,
  SymbolExtractor,
  walkDirectory,
} from "@exaix/portal/knowledge";
