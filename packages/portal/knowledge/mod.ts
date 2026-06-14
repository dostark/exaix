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
export { computeAdaptiveSampleSize, detectPatterns, selectSampleFiles } from "./pattern_detector.ts";
export {
  type IDenoDocFunctionDef,
  type IDenoDocJsDoc,
  type IDenoDocLocation,
  type IDenoDocNode,
  type IDenoDocParam,
  type IDenoDocReturnType,
  type IDenoDocVariableDef,
  type IDocCommandRunner,
  type ISymbolExtractor,
  type ISymbolExtractorOptions,
  SymbolExtractor,
} from "./symbol_extractor.ts";
export {
  createDefaultSymbolExtractorRegistry,
  EMPTY_SYMBOL_EXTRACTOR,
  type ISymbolExtractorRegistry,
  SymbolExtractorRegistry,
} from "./symbol_extractor_registry.ts";
export { loadKnowledge, saveKnowledge } from "./knowledge_persistence.ts";
export { GitHeadResolver } from "./git_head_resolver.ts";
export type { IGitHeadResolver } from "./git_head_resolver.ts";
export { AstAnalyzer } from "./ast_analyzer.ts";
export type { IAstDiagnostics } from "./ast_analyzer.ts";
export { ArchitectureInferrer, buildFallbackOverview } from "./architecture_inferrer.ts";
export type { IArchitectureInferrerInput, IArchitectureValidator } from "./architecture_inferrer.ts";
export { GitHistoryAnalyzer } from "./git_history_analyzer.ts";
export type { IGitAuthorStats, IGitHistoryResult, IGitHotspot } from "./git_history_analyzer.ts";
export { LicenseDetector } from "./license_detector.ts";
export type { ILicenseInfo } from "./license_detector.ts";
export { TestRunner } from "./test_runner.ts";
export type { ITestInfo } from "./test_runner.ts";
export { VulnerabilityScanner } from "./vulnerability_scanner.ts";
export type { IVulnerabilityResult } from "./vulnerability_scanner.ts";
export { KnowledgeInvalidationStrategy } from "./knowledge_invalidation_strategy.ts";
export type {
  IKnowledgeInvalidationStrategy,
  IKnowledgeValidityCheck,
  KnowledgeAnalysisMode,
  KnowledgeValidityReason,
} from "./knowledge_invalidation_strategy.ts";
export { PortalKnowledgeService } from "./portal_knowledge_service.ts";
export type { IPortalKnowledgeServiceOptions } from "./portal_knowledge_service.ts";
