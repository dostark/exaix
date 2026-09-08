/**
 * @module IPortalKnowledgeService
 * @path packages/core/src/types/i_portal_knowledge_service.ts
 * @description Service interface and configuration type for PortalKnowledgeService
 * (Phase 119), which performs deep codebase analysis of mounted portals and
 * persists structured knowledge in Memory/Projects/{portal}/.
 * @architectural-layer Shared
 * @related-files [packages/portal/knowledge/portal_knowledge_service.ts, packages/core/src/types/mod.ts]
 */

import type { IPortalKnowledge } from "@exaix/schemas";

import type {
  ContextItemScoreKind,
  ContextResultStatus,
  ContextUnavailableReason,
  PortalAnalysisMode,
} from "@exaix/core/types";

/**
 * Configuration for the PortalKnowledgeService.
 */
export interface IPortalKnowledgeConfig {
  /** Whether to automatically analyze the portal codebase after mount. */
  autoAnalyzeOnMount: boolean;
  /** Default analysis depth: `quick` is directory scan + config parsing only (no LLM);
   *  `standard` adds architecture inference + symbol extraction; `deep` adds full
   *  convention mapping + complete symbol index. */
  defaultMode: PortalAnalysisMode;
  /** Maximum number of files to scan in quick mode. Default: 200. */
  quickScanLimit: number;
  /** Maximum number of files whose content is read for analysis. Default: 50. */
  maxFilesToRead: number;
  /** File/directory name patterns to skip during traversal. */
  ignorePatterns: string[];
  /** Hours before existing knowledge is considered stale. Default: 168 (1 week). */
  staleness: number;
  /** Whether to call the LLM for architecture inference in standard/deep modes. */
  useLlmInference: boolean;
  /** Whether to enable relevance-based retrieval via HNSW embedding search. */
  relevanceSearchEmbeddingEnabled: boolean;
  /** Maximum number of files to sample for PatternDetector content analysis. Default: 50. */
  maxPatternDetectorSampleSize?: number;
  /** Minimum number of files to sample for PatternDetector content analysis. Default: 10. */
  minPatternDetectorSampleSize?: number;
  /** Whether to run AST-level analysis in standard/deep modes. Default: true. */
  enableAstAnalysis?: boolean;
  /** Whether to run test execution analysis (deep mode only). Default: false. */
  enableTestExecution?: boolean;
  /** Whether to run dependency vulnerability scan (deep mode only). Default: false. */
  enableVulnerabilityScan?: boolean;
  /** Whether to run git history analysis in standard/deep modes. Default: true. */
  enableGitHistoryAnalysis?: boolean;
  /** Max commits to analyze in git history. Default: 500. */
  gitHistoryCommitLimit?: number;
  /** Git since filter (e.g. "1.year", "30.days"). Default: "1.year". */
  gitHistorySince?: string;
}

/** One scored, provenance-labelled context candidate. `source` is a portal-relative
 *  reference or an approved global-learning ID — never a host absolute path. */
export interface IScoredContextItem {
  id: string;
  source: string;
  text: string;
  score: number;
  scoreKind: ContextItemScoreKind;
}

/** Result of a scoped context query. `unavailable` always carries zero `items` and a
 *  {@link ContextUnavailableReason}; `ok` may still have zero items when nothing matched
 *  a real search (use `NO_HITS` for that case instead). */
export interface IScoredContextResult {
  status: ContextResultStatus;
  reason?: ContextUnavailableReason;
  items: readonly IScoredContextItem[];
}

/** Bounded structured query against one portal's cached knowledge index. Never triggers
 *  `analyze`/`getOrAnalyze` — a cold or missing index resolves to `status: "unavailable"`. */
export interface IPortalContextQuery {
  portalAlias: string;
  query: string;
  limit: number;
  maxTokens: number;
  signal?: AbortSignal;
}

/** Implementations MUST persist results via `IMemoryBankService`, never throw on
 *  partial analysis failure (degrade gracefully), and respect
 *  {@link IPortalKnowledgeConfig.ignorePatterns} during traversal. */
export interface IPortalKnowledgeService {
  /** `mode` overrides `config.defaultMode` when supplied. */
  analyze(
    portalAlias: string,
    portalPath: string,
    mode?: PortalAnalysisMode,
  ): Promise<IPortalKnowledge>;

  /** Equivalent to `(await isStale(alias)) ? analyze(alias, path) : loadCached(alias)`. */
  getOrAnalyze(
    portalAlias: string,
    portalPath: string,
  ): Promise<IPortalKnowledge>;

  /** True if no cached knowledge exists or it exceeds the configured
   *  {@link IPortalKnowledgeConfig.staleness} threshold. */
  isStale(portalAlias: string): Promise<boolean>;

  /** Currently a CLI-only operation (`exactl portal analyze [--force]`); `changedFiles`
   *  is reserved for future automatic integration and may be ignored by implementations. */
  updateKnowledge(
    portalAlias: string,
    portalPath: string,
    changedFiles?: string[],
  ): Promise<IPortalKnowledge>;

  /** Returns `undefined` (fall back to full analysis) when
   *  `relevanceSearchEmbeddingEnabled` is false or the HNSW index is cold. */
  getRelevantContext(
    requestText: string,
    portalPath: string,
    maxTokens: number,
  ): Promise<string | undefined>;

  /** Structured, scored equivalent of {@link getRelevantContext}. Reuses the existing
   *  index/search/chunk path; never calls `analyze`/`getOrAnalyze` or builds an index. */
  queryContext(query: IPortalContextQuery): Promise<IScoredContextResult>;

  /** Returns the in-memory cached knowledge for `portalAlias`, or `undefined` if this
   *  portal has never been analyzed in this process. Never triggers analysis. */
  loadCachedKnowledge(portalAlias: string): Promise<IPortalKnowledge | undefined>;
}
