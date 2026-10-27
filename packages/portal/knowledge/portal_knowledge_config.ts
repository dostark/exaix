/**
 * @module PortalKnowledgeConfigBuilder
 * @path packages/portal/knowledge/portal_knowledge_config.ts
 * @description Maps the persisted `[portal_knowledge]` config section to the
 * `IPortalKnowledgeConfig` the service consumes (Phase 178 Step 2). Both
 * composition roots (daemon and exactl) call this, so a new key cannot be wired
 * into one root and forgotten in the other.
 * @architectural-layer Portal
 * @related-files [apps/daemon/main.ts, apps/exactl/src/init.ts, packages/core/src/types/i_portal_knowledge_service.ts]
 */

import type { Config } from "@exaix/schemas";
import type { IPortalKnowledgeConfig } from "@exaix/core/types";

/** The `[portal_knowledge]` section of a parsed config. */
type PortalKnowledgeConfigSection = Config["portal_knowledge"];

/** Builds the service config from the persisted config section. Every optional boolean resolves to a concrete value,
 *  so the service sees no `undefined` for a key the schema defaults. */
export function buildPortalKnowledgeConfig(
  section: PortalKnowledgeConfigSection,
): IPortalKnowledgeConfig {
  return {
    autoAnalyzeOnMount: section.auto_analyze_on_mount,
    defaultMode: section.default_mode,
    quickScanLimit: section.quick_scan_limit,
    maxFilesToRead: section.max_files_to_read,
    ignorePatterns: section.ignore_patterns,
    staleness: section.staleness_hours,
    useLlmInference: section.use_llm_inference,
    relevanceSearchEmbeddingEnabled: section.relevance_search_embedding_enabled ?? false,
    maxPatternDetectorSampleSize: section.max_pattern_detector_sample_size,
    minPatternDetectorSampleSize: section.min_pattern_detector_sample_size,
    enableAstAnalysis: section.enable_ast_analysis,
    enableTestExecution: section.enable_test_execution,
    enableVulnerabilityScan: section.enable_vulnerability_scan,
    enableGitHistoryAnalysis: section.enable_git_history_analysis,
    gitHistoryCommitLimit: section.git_history_commit_limit,
    gitHistorySince: section.git_history_since,
    enableSymbolLevelDependencyGraph: section.enable_symbol_level_dependency_graph ?? false,
  };
}
