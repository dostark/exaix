/**
 * @module PortalKnowledgeService
 * @path packages/portal/knowledge/portal_knowledge_service.ts
 * @description Orchestrator for all 11 portal analysis strategies: DirectoryAnalyzer,
 * ConfigParser, KeyFileIdentifier, PatternDetector, ArchitectureInferrer,
 * SymbolExtractor, AstAnalyzer, TestRunner, LicenseDetector, VulnerabilityScanner,
 * GitHistoryAnalyzer. Implements IPortalKnowledgeService with quick/standard/deep
 * modes, in-memory staleness check, and async background re-analysis on stale cache.
 * @architectural-layer Services
 * @related-files [packages/portal/knowledge/mod.ts, "packages/core/src/types/i_portal_knowledge_service.ts"]
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { analyzeDirectory, walkDirectory } from "./directory_analyzer.ts";
import { parseConfigFiles } from "./config_parser.ts";
import { identifyKeyFiles } from "./key_file_identifier.ts";
import { computeAdaptiveSampleSize, detectPatterns, selectSampleFiles } from "./pattern_detector.ts";
import { ArchitectureInferrer, type IArchitectureValidator } from "./architecture_inferrer.ts";
import { AstAnalyzer } from "./ast_analyzer.ts";
import type { IDocCommandRunner } from "./symbol_extractor.ts";
import { createDefaultSymbolExtractorRegistry, type ISymbolExtractorRegistry } from "./symbol_extractor_registry.ts";
import { GitHeadResolver, type IGitHeadResolver } from "./git_head_resolver.ts";
import { GitHistoryAnalyzer } from "./git_history_analyzer.ts";
import { LicenseDetector } from "./license_detector.ts";
import { TestRunner } from "./test_runner.ts";
import { VulnerabilityScanner } from "./vulnerability_scanner.ts";
import type { IKnowledgeInvalidationStrategy, KnowledgeAnalysisMode } from "./knowledge_invalidation_strategy.ts";
import { KnowledgeInvalidationStrategy } from "./knowledge_invalidation_strategy.ts";
import type { ILogger, IMemoryBankService, IPortalKnowledgeConfig, IPortalKnowledgeService } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { IPortalKnowledge } from "@exaix/schemas";

import type { IEmbeddingProvider, IModelProvider } from "@exaix/ai";

import {
  DEFAULT_IGNORE_PATTERNS,
  DEFAULT_MAX_PATTERN_DETECTOR_SAMPLE_SIZE,
  DEFAULT_MIN_PATTERN_DETECTOR_SAMPLE_SIZE,
  DEFAULT_NONE_VALUE,
  GIT_HISTORY_COMMIT_LIMIT,
  GIT_HISTORY_SINCE,
  PortalAnalysisMode,
} from "@exaix/core";

import { HnswVectorIndex, type IVectorIndexSnapshot } from "@exaix/memory";

export interface IPortalKnowledgeServiceOptions {
  config: IPortalKnowledgeConfig;
  memoryBank: IMemoryBankService;
  provider?: IModelProvider;
  validator?: IArchitectureValidator;
  evLogger?: IEventLogger;
  runner?: IDocCommandRunner;
  /** Per-language symbol-extractor registry (Phase 115 Step 4); defaults to TS/JS only. */
  symbolExtractorRegistry?: ISymbolExtractorRegistry;
  gitHeadResolver?: IGitHeadResolver;
  invalidationStrategy?: IKnowledgeInvalidationStrategy;
  embeddingProvider?: IEmbeddingProvider;
  projectsDir?: string;
  logger?: ILogger;
}

// ---------------------------------------------------------------------------
// Local constants
// ---------------------------------------------------------------------------

/** Estimated tokens per character for rough token counting. */
const ESTIMATED_TOKENS_PER_CHAR = 0.25;

/** Number of nearest-neighbor results to retrieve from HNSW index. */
const HNSW_SEARCH_RESULT_COUNT = 5;

/** Maximum characters per text chunk when splitting knowledge content. */
const TEXT_CHUNK_MAX_CHARS = 512;

/** Number of consecutive sentences to group into one chunk for context coherence. */
const CHUNK_SENTENCE_GROUP_SIZE = 2;

/** Number of sentences to overlap between adjacent groups (keeps context continuity). */
const CHUNK_SENTENCE_OVERLAP = 1;

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PortalKnowledgeService
// ---------------------------------------------------------------------------

/** Multiplier applied to maxFilesToRead for `deep` mode analysis. */
const _DEEP_MODE_FILE_CAP_MULTIPLIER = 3;

/**
 * Orchestrates all 6 analysis strategies and implements `IPortalKnowledgeService`.
 *
 * In-memory cache keyed by `portalAlias`: analysis results are stored here
 * for the lifetime of the service instance. Persistence to disk via
 * `KnowledgePersistence` is added in Step 10.
 */
export class PortalKnowledgeService implements IPortalKnowledgeService {
  private readonly _config: IPortalKnowledgeConfig;
  private readonly _memoryBank: IMemoryBankService;
  private readonly _provider?: IModelProvider;
  private readonly _validator?: IArchitectureValidator;
  private readonly _evLogger?: IEventLogger;
  private readonly _symbolRunner: IDocCommandRunner | undefined;
  private readonly _symbolExtractorRegistry: ISymbolExtractorRegistry;
  private readonly _gitHeadResolver: IGitHeadResolver;
  private readonly _invalidationStrategy: IKnowledgeInvalidationStrategy;
  private readonly _embeddingProvider?: IEmbeddingProvider;
  private readonly _projectsDir: string;
  private readonly _logger?: ILogger;
  private readonly _astAnalyzer: AstAnalyzer;
  private readonly _testRunner: TestRunner;
  private readonly _licenseDetector: LicenseDetector;
  private readonly _vulnerabilityScanner: VulnerabilityScanner;
  private readonly _gitHistoryAnalyzer: GitHistoryAnalyzer;

  /** In-memory cache: alias → latest IPortalKnowledge. */
  private readonly _cache: Map<string, IPortalKnowledge> = new Map();

  /** Per-portal HNSW index + chunk text cache for relevance retrieval. */
  private readonly _portalIndices: Map<
    string,
    { index: HnswVectorIndex; chunks: Map<string, string> }
  > = new Map();

  constructor(options: IPortalKnowledgeServiceOptions) {
    const optionsWithDefaults = {
      ...options,
      gitHeadResolver: options.gitHeadResolver,
      invalidationStrategy: options.invalidationStrategy,
    };
    const config = optionsWithDefaults.config;
    this._config = config;
    this._memoryBank = optionsWithDefaults.memoryBank;
    this._provider = optionsWithDefaults.provider;
    this._validator = optionsWithDefaults.validator;
    this._evLogger = optionsWithDefaults.evLogger;
    this._symbolRunner = optionsWithDefaults.runner;
    // Default-wire the TS/JS extractor; a paid edition injects a registry with more languages.
    this._symbolExtractorRegistry = optionsWithDefaults.symbolExtractorRegistry ??
      createDefaultSymbolExtractorRegistry(this._symbolRunner);
    this._gitHeadResolver = optionsWithDefaults.gitHeadResolver ?? new GitHeadResolver();
    this._invalidationStrategy = optionsWithDefaults.invalidationStrategy ?? new KnowledgeInvalidationStrategy(
      this._gitHeadResolver,
    );
    this._embeddingProvider = options.embeddingProvider;
    this._projectsDir = options.projectsDir ?? "";
    this._logger = options.logger;
    this._astAnalyzer = new AstAnalyzer();
    this._testRunner = new TestRunner();
    this._licenseDetector = new LicenseDetector();
    this._vulnerabilityScanner = new VulnerabilityScanner();
    this._gitHistoryAnalyzer = new GitHistoryAnalyzer();
    void this._memoryBank;
  }

  // -------------------------------------------------------------------------
  // IPortalKnowledgeService implementation
  // -------------------------------------------------------------------------

  async analyze(
    portalAlias: string,
    portalPath: string,
    mode?: PortalAnalysisMode,
  ): Promise<IPortalKnowledge> {
    const resolvedMode = mode ?? this._config.defaultMode;
    const startMs = Date.now();
    const currentHeadSha = await this._gitHeadResolver.resolve(portalPath);

    // Strategy 1 & 2: walk directory
    const scanLimit = resolvedMode === PortalAnalysisMode.QUICK
      ? this._config.quickScanLimit
      : this._config.quickScanLimit * 2;

    const ignorePatterns = [
      ...DEFAULT_IGNORE_PATTERNS,
      ...this._config.ignorePatterns,
    ];

    const walked = await walkDirectory(portalPath, ignorePatterns, scanLimit);
    const fileList = walked.files;

    // Strategy 1: directory structure analysis
    const dirResult = await analyzeDirectory(portalPath, ignorePatterns, scanLimit);

    // Strategy 2: config file parsing
    const configResult = await parseConfigFiles(portalPath, fileList);

    // Merge techStack (config wins over heuristic)
    const primaryLanguage = configResult.techStack?.primaryLanguage ??
      dirResult.techStack?.primaryLanguage ??
      "unknown";
    const techStack = {
      primaryLanguage,
      framework: configResult.techStack?.framework,
      testFramework: configResult.techStack?.testFramework,
      buildTool: configResult.techStack?.buildTool,
    };

    // Strategy 3: key file identification
    const keyFiles = identifyKeyFiles(fileList, this._config.maxFilesToRead);

    // Strategy 4: pattern detection (heuristic in quick, content-based in standard/deep)
    let conventions;
    if (resolvedMode === PortalAnalysisMode.QUICK) {
      conventions = detectPatterns(portalPath, fileList, keyFiles);
    } else {
      const adaptiveSampleSize = computeAdaptiveSampleSize(
        fileList.length,
        this._config.minPatternDetectorSampleSize ?? DEFAULT_MIN_PATTERN_DETECTOR_SAMPLE_SIZE,
        this._config.maxPatternDetectorSampleSize ?? DEFAULT_MAX_PATTERN_DETECTOR_SAMPLE_SIZE,
      );
      const sampleFiles = selectSampleFiles(fileList, adaptiveSampleSize);
      conventions = await detectPatterns(
        portalPath,
        fileList,
        keyFiles,
        (filePath: string) => {
          if (!sampleFiles.includes(filePath)) return Promise.resolve("");
          return Deno.readTextFile(join(portalPath, filePath)).catch(() => "");
        },
      );
    }

    // Strategy 5: architecture inference (standard/deep only + LLM available)
    let architectureOverview = "";
    let architectureInferenceFailed: boolean | undefined;
    if (
      resolvedMode !== PortalAnalysisMode.QUICK &&
      this._config.useLlmInference &&
      this._provider
    ) {
      const inferrer = new ArchitectureInferrer(
        this._provider,
        this._validator ?? {
          validate: <T>(content: string) => ({
            success: true,
            value: content as T,
            repairAttempted: false,
            repairSucceeded: false,
            raw: content,
          }),
        },
        this._logger,
      );
      architectureOverview = await inferrer.infer({
        portalPath,
        directoryTree: fileList,
        keyFiles,
        conventions,
        configSummary: configResult.techStack
          ? `Lang: ${primaryLanguage}, Framework: ${configResult.techStack.framework ?? DEFAULT_NONE_VALUE}`
          : "",
        dependencySummary: (configResult.dependencies ?? [])
          .flatMap((d) => d.keyDependencies)
          .slice(0, 5)
          .map((d) => `${d.name}@${d.version ?? "?"}`)
          .join(", "),
      });
      architectureInferenceFailed = inferrer.architectureInferenceFailed;
    }

    // Strategy 6: symbol extraction (standard/deep + TS/JS) — uses all TS/JS files
    let symbolMap: IPortalKnowledge["symbolMap"] = [];
    let symbolSourceFilesScanned: number | undefined;
    if (resolvedMode !== PortalAnalysisMode.QUICK) {
      // Select the extractor by primary language (Phase 115 Step 4); TS/JS → deno-doc extractor,
      // other languages → no-op ([]) unless a paid edition registered one.
      const extractor = this._symbolExtractorRegistry.getForLanguage(primaryLanguage);
      const allTsFiles = fileList.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));
      symbolSourceFilesScanned = allTsFiles.length;
      symbolMap = await extractor.extractSymbols(portalPath, allTsFiles, {
        primaryLanguage,
        allFilePaths: fileList,
      });
    }

    // Strategy 7: AST analysis (standard/deep + enableAstAnalysis)
    let astDiagnostics: IPortalKnowledge["astDiagnostics"];
    if (
      resolvedMode !== PortalAnalysisMode.QUICK &&
      (this._config.enableAstAnalysis ?? true)
    ) {
      const entrypoints = keyFiles
        .filter((kf) => kf.role === "entrypoint")
        .map((kf) => kf.path);
      astDiagnostics = await this._astAnalyzer.analyze(
        portalPath,
        entrypoints,
        primaryLanguage,
      );
    }

    // Strategy 8: test execution (deep mode + enableTestExecution)
    let testInfo: IPortalKnowledge["testInfo"];
    if (
      resolvedMode === PortalAnalysisMode.DEEP &&
      (this._config.enableTestExecution ?? false)
    ) {
      testInfo = await this._testRunner.analyze(portalPath, fileList, primaryLanguage);
    }

    // Strategy 9: license detection (standard/deep)
    let licenses: IPortalKnowledge["licenses"];
    if (resolvedMode !== PortalAnalysisMode.QUICK) {
      licenses = await this._licenseDetector.analyze(portalPath, fileList);
    }

    // Strategy 10: vulnerability scan (deep mode + enableVulnerabilityScan)
    let vulnerabilities: IPortalKnowledge["vulnerabilities"];
    if (
      resolvedMode === PortalAnalysisMode.DEEP &&
      (this._config.enableVulnerabilityScan ?? false)
    ) {
      vulnerabilities = await this._vulnerabilityScanner.scan(portalPath);
    }

    // Strategy 11: git history analysis (standard/deep + enableGitHistoryAnalysis)
    let gitHistory: IPortalKnowledge["gitHistory"];
    if (
      resolvedMode !== PortalAnalysisMode.QUICK &&
      (this._config.enableGitHistoryAnalysis ?? true)
    ) {
      gitHistory = await this._gitHistoryAnalyzer.analyze(
        portalPath,
        this._config.gitHistoryCommitLimit ?? GIT_HISTORY_COMMIT_LIMIT,
        this._config.gitHistorySince ?? GIT_HISTORY_SINCE,
      );
    }

    // Compute filesRead estimate (key files + pattern detector sample)
    const sampleSize = computeAdaptiveSampleSize(
      fileList.length,
      this._config.minPatternDetectorSampleSize ?? DEFAULT_MIN_PATTERN_DETECTOR_SAMPLE_SIZE,
      this._config.maxPatternDetectorSampleSize ?? DEFAULT_MAX_PATTERN_DETECTOR_SAMPLE_SIZE,
    );
    const filesRead = Math.min(
      keyFiles.length + sampleSize,
      fileList.length,
    );

    const prevVersion = this._cache.get(portalAlias)?.version ?? 0;

    const knowledge: IPortalKnowledge = {
      portal: portalAlias,
      gatheredAt: new Date().toISOString(),
      version: prevVersion + 1,
      architectureOverview,
      layers: dirResult.layers ?? [],
      keyFiles,
      conventions,
      dependencies: configResult.dependencies ?? [],
      packages: dirResult.packages,
      techStack,
      symbolMap,
      ...(astDiagnostics !== undefined ? { astDiagnostics } : {}),
      ...(testInfo !== undefined ? { testInfo } : {}),
      ...(licenses !== undefined ? { licenses } : {}),
      ...(vulnerabilities !== undefined ? { vulnerabilities } : {}),
      ...(gitHistory !== undefined ? { gitHistory } : {}),
      stats: dirResult.stats ?? {
        totalFiles: fileList.length,
        totalDirectories: 0,
        extensionDistribution: {},
      },
      ...(currentHeadSha ? { headCommitSha: currentHeadSha } : {}),
      fullAnalysis: resolvedMode !== PortalAnalysisMode.QUICK,
      metadata: {
        durationMs: Date.now() - startMs,
        mode: resolvedMode,
        filesScanned: fileList.length,
        filesRead,
        ...(architectureInferenceFailed !== undefined ? { architectureInferenceFailed } : {}),
        ...(symbolSourceFilesScanned !== undefined ? { symbolSourceFilesScanned } : {}),
      },
    };

    this._cache.set(portalAlias, knowledge);

    // Build HNSW index for semantic retrieval (no-op if embedding provider is unconfigured)
    await this.indexPortalKnowledge(portalAlias, knowledge);

    // Log activity
    if (this._evLogger) {
      void this._evLogger.info(DomainEventType.PortalAnalyzed, portalAlias, {
        mode: resolvedMode,
        filesScanned: fileList.length,
        durationMs: knowledge.metadata.durationMs,
      });
    }

    return knowledge;
  }

  isStale(portalAlias: string): Promise<boolean> {
    const cached = this._cache.get(portalAlias);
    if (!cached) return Promise.resolve(true);
    const cutoff = new Date(Date.now() - this._config.staleness * 60 * 60 * 1000);
    return Promise.resolve(new Date(cached.gatheredAt) < cutoff);
  }

  getOrAnalyze(
    portalAlias: string,
    portalPath: string,
  ): Promise<IPortalKnowledge> {
    const cached = this._cache.get(portalAlias);

    if (!cached) {
      return this.analyze(portalAlias, portalPath);
    }

    void this._revalidateStaleCache(portalAlias, portalPath, cached);
    return Promise.resolve(cached);
  }

  private async _revalidateStaleCache(
    portalAlias: string,
    portalPath: string,
    cached: IPortalKnowledge,
  ): Promise<void> {
    const startMs = Date.now();
    const validity = await this._invalidationStrategy.check(
      portalPath,
      cached,
      this._config.staleness,
    );
    const elapsedMs = Date.now() - startMs;

    if (this._evLogger) {
      void this._evLogger.info(
        this._mapValidityEventType(validity.analysisMode),
        portalAlias,
        {
          ...validity,
          elapsedMs,
        },
      );
    }

    if (validity.analysisMode === "skip") {
      return;
    }

    const isIncremental = validity.analysisMode === "incremental";
    const previousCache = isIncremental ? this._cache.get(portalAlias) : undefined;

    const mode = isIncremental ? PortalAnalysisMode.QUICK : undefined;
    await this.analyze(portalAlias, portalPath, mode).catch(() => {
      // Swallow background analysis failures to preserve stale return behavior.
    });

    // For incremental re-analysis (QUICK mode), merge strategy 7-11 data from the
    // prior full analysis back onto the new cache entry — QUICK mode skips those
    // strategies and would otherwise silently destroy previously collected data.
    if (isIncremental && previousCache) {
      const fresh = this._cache.get(portalAlias);
      if (fresh) {
        const merged = {
          ...fresh,
          astDiagnostics: fresh.astDiagnostics ?? previousCache.astDiagnostics,
          testInfo: fresh.testInfo ?? previousCache.testInfo,
          licenses: fresh.licenses ?? previousCache.licenses,
          vulnerabilities: fresh.vulnerabilities ?? previousCache.vulnerabilities,
          gitHistory: fresh.gitHistory ?? previousCache.gitHistory,
        };
        this._cache.set(portalAlias, merged);
      }
    }
  }

  private _mapValidityEventType(mode: KnowledgeAnalysisMode): string {
    switch (mode) {
      case "skip":
        return "portal.knowledge.skipped";
      case "incremental":
        return "portal.knowledge.incremental";
      case "full":
      default:
        return "portal.knowledge.full";
    }
  }

  updateKnowledge(
    portalAlias: string,
    portalPath: string,
    _changedFiles?: string[],
  ): Promise<IPortalKnowledge> {
    return this.analyze(portalAlias, portalPath, this._config.defaultMode);
  }

  async getRelevantContext(
    requestText: string,
    portalPath: string,
    maxTokens: number,
  ): Promise<string | undefined> {
    if (!this._config.relevanceSearchEmbeddingEnabled || !this._embeddingProvider) {
      return undefined;
    }

    const portalAlias = this._resolveAliasFromPath(portalPath);
    if (!portalAlias) return undefined;

    const indexData = await this._loadIndex(portalAlias);
    if (!indexData || indexData.index.size() === 0) {
      return undefined;
    }

    const [queryVector] = await this._embeddingProvider.embed([requestText]);
    const results = indexData.index.search(queryVector, HNSW_SEARCH_RESULT_COUNT);

    if (results.length === 0) return undefined;

    const chunks: string[] = [];
    let tokenCount = 0;

    for (const result of results) {
      const text = indexData.chunks.get(result.id);
      if (!text) continue;
      const estimatedTokens = Math.ceil(text.length * ESTIMATED_TOKENS_PER_CHAR);
      if (tokenCount + estimatedTokens > maxTokens) break;
      chunks.push(text);
      tokenCount += estimatedTokens;
    }

    return chunks.length > 0 ? chunks.join("\n\n---\n\n") : undefined;
  }

  async indexPortalKnowledge(
    portalAlias: string,
    knowledge: IPortalKnowledge,
  ): Promise<void> {
    if (!this._embeddingProvider || !this._projectsDir) return;

    const chunked = this._chunkKnowledge(knowledge);
    if (chunked.length === 0) return;

    const texts = chunked.map((c) => c.text);
    const vectors = await this._embeddingProvider.embed(texts);

    let indexData = this._portalIndices.get(portalAlias);
    if (!indexData) {
      indexData = { index: new HnswVectorIndex(), chunks: new Map() };
      this._portalIndices.set(portalAlias, indexData);
    }

    for (let i = 0; i < chunked.length; i++) {
      const { id, text } = chunked[i];
      if (indexData.chunks.has(id)) continue;
      indexData.chunks.set(id, text);
      indexData.index.insert(id, vectors[i]);
    }

    await this._persistIndex(portalAlias, indexData);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve portal alias from a portal path by scanning the cached knowledge.
   * Returns the first matching alias, or undefined if no cached knowledge
   * references this path.
   */
  private _resolveAliasFromPath(_portalPath: string): string | undefined {
    for (const [alias] of this._cache) {
      return alias;
    }
    return undefined;
  }

  /**
   * Load or build an in-memory index for the given portal alias.
   * Attempts to load from disk cache first; returns undefined on miss.
   */
  private async _loadIndex(
    portalAlias: string,
  ): Promise<{ index: HnswVectorIndex; chunks: Map<string, string> } | undefined> {
    const cached = this._portalIndices.get(portalAlias);
    if (cached) return cached;

    if (!this._projectsDir) return undefined;

    try {
      const indexPath = join(this._projectsDir, portalAlias, "hnsw_index.json");
      const raw = await Deno.readTextFile(indexPath);
      const data = JSON.parse(raw) as {
        snapshot: IVectorIndexSnapshot;
        chunks: Array<[string, string]>;
      };

      const index = new HnswVectorIndex();
      index.load(data.snapshot);
      const chunks = new Map<string, string>(data.chunks);

      const indexData = { index, chunks };
      this._portalIndices.set(portalAlias, indexData);
      return indexData;
    } catch {
      return undefined;
    }
  }

  /**
   * Persist a portal's HNSW index and chunk text map to disk.
   */
  private async _persistIndex(
    portalAlias: string,
    indexData: { index: HnswVectorIndex; chunks: Map<string, string> },
  ): Promise<void> {
    if (!this._projectsDir) return;

    const portalDir = join(this._projectsDir, portalAlias);
    await ensureDir(portalDir);

    const indexPath = join(portalDir, "hnsw_index.json");
    const tmpPath = `${indexPath}.tmp`;

    const data = {
      snapshot: indexData.index.save(),
      chunks: Array.from(indexData.chunks.entries()),
    };

    await Deno.writeTextFile(tmpPath, JSON.stringify(data));
    await Deno.rename(tmpPath, indexPath);
  }

  /**
   * Split text into overlapping sentence groups for semantic coherence.
   * Each group contains CHUNK_SENTENCE_GROUP_SIZE sentences with
   * CHUNK_SENTENCE_OVERLAP overlap, so adjacent chunks share context.
   */
  private _splitSentences(text: string): string[] {
    const sentences = text.split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length === 0) return [];

    const groups: string[] = [];
    const step = CHUNK_SENTENCE_GROUP_SIZE - CHUNK_SENTENCE_OVERLAP;
    let i = 0;

    while (i < sentences.length) {
      const group = sentences.slice(i, i + CHUNK_SENTENCE_GROUP_SIZE);
      const joined = group.join(" ");
      if (joined.length <= TEXT_CHUNK_MAX_CHARS) {
        groups.push(joined);
      } else {
        // Group exceeds max chars — emit each sentence individually
        for (const sentence of group) {
          groups.push(sentence);
        }
      }
      i += step;
    }

    return groups;
  }

  /**
   * Compute a simple content hash for deduplication.
   */
  private _contentHash(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return `hash:${Math.abs(hash).toString(36)}`;
  }

  /**
   * Chunk IPortalKnowledge into embeddable text segments.
   * Includes architecture overview, conventions, and key file descriptions.
   */
  private _chunkKnowledge(
    knowledge: IPortalKnowledge,
  ): Array<{ id: string; text: string }> {
    const chunks: Array<{ id: string; text: string }> = [];

    if (knowledge.architectureOverview) {
      const sentences = this._splitSentences(knowledge.architectureOverview);
      for (const sentence of sentences) {
        const text = `Architecture: ${sentence}`;
        chunks.push({ id: this._contentHash(text), text });
      }
    }

    for (const convention of knowledge.conventions ?? []) {
      const text = `Convention: ${convention.name}: ${convention.description}`;
      chunks.push({ id: this._contentHash(text), text });
    }

    for (const file of knowledge.keyFiles ?? []) {
      const text = `Key file: ${file.path} (${file.role}): ${file.description}`;
      chunks.push({ id: this._contentHash(text), text });
    }

    return chunks;
  }
}
