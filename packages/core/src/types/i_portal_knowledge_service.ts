/**
 * @module IPortalKnowledgeService
 * @path src/shared/interfaces/i_portal_knowledge_service.ts
 * @description Service interface and configuration type for PortalKnowledgeService
 * (Phase 46), which performs deep codebase analysis of mounted portals and
 * persists structured knowledge in Memory/Projects/{portal}/.
 * @architectural-layer Shared
 * @related-files [src/services/portal_knowledge/portal_knowledge_service.ts, src/shared/interfaces/mod.ts]
 */

import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import type { PortalAnalysisMode } from "@exaix/core";

/**
 * Configuration for the PortalKnowledgeService.
 */
export interface IPortalKnowledgeConfig {
  /** Whether to automatically analyze the portal codebase after mount. */
  autoAnalyzeOnMount: boolean;
  /**
   * Default analysis depth.
   * - `quick`    — directory scan + config parsing only; no LLM (<5 s)
   * - `standard` — adds architecture inference (1 LLM call) + symbol extraction (~15 s)
   * - `PortalAnalysisMode.DEEP`     — full convention mapping + complete symbol index (~60 s)
   */
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
}

/**
 * Service contract for portal codebase knowledge gathering.
 *
 * Implementations MUST:
 * - Persist results in `Memory/Projects/{portalAlias}/` via `IMemoryBankService`
 * - Never throw on partial analysis failure — degrade gracefully
 * - Respect {@link IPortalKnowledgeConfig.ignorePatterns} during traversal
 */
export interface IPortalKnowledgeService {
  /**
   * Perform a full analysis of the portal codebase at the given path.
   *
   * @param portalAlias - The portal alias (used for persistence key).
   * @param portalPath  - Absolute filesystem path to the portal root.
   * @param mode        - Analysis depth; overrides `config.defaultMode` when supplied.
   * @returns           Fully populated {@link IPortalKnowledge}.
   */
  analyze(
    portalAlias: string,
    portalPath: string,
    mode?: PortalAnalysisMode,
  ): Promise<IPortalKnowledge>;

  /**
   * Return cached knowledge if fresh, otherwise run a new analysis.
   *
   * Equivalent to: `(await isStale(alias)) ? analyze(alias, path) : loadCached(alias)`.
   *
   * @param portalAlias - The portal alias.
   * @param portalPath  - Absolute filesystem path to the portal root.
   * @returns           Fresh or cached {@link IPortalKnowledge}.
   */
  getOrAnalyze(
    portalAlias: string,
    portalPath: string,
  ): Promise<IPortalKnowledge>;

  /**
   * Return `true` if no cached knowledge exists or it has exceeded
   * the configured {@link IPortalKnowledgeConfig.staleness} threshold.
   *
   * @param portalAlias - The portal alias to check.
   */
  isStale(portalAlias: string): Promise<boolean>;

  /**
   * Perform an incremental knowledge update.
   *
   * In Phase 46 this is a **CLI-only** operation (triggered by
   * `exactl portal analyze [--force]`). The `changedFiles` parameter is
   * reserved for a future automatic-integration phase and may be ignored by
   * current implementations.
   *
   * @param portalAlias  - The portal alias.
   * @param portalPath   - Absolute filesystem path to the portal root.
   * @param changedFiles - Optional list of changed file paths; reserved for future use.
   * @returns            Updated {@link IPortalKnowledge}.
   */
  updateKnowledge(
    portalAlias: string,
    portalPath: string,
    changedFiles?: string[],
  ): Promise<IPortalKnowledge>;
}
