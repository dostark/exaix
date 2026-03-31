/**
 * @module PortalKnowledgeService
 * @path src/services/portal_knowledge/portal_knowledge_service.ts
 * @description Orchestrator for all 6 portal analysis strategies: DirectoryAnalyzer,
 * ConfigParser, KeyFileIdentifier, PatternDetector, ArchitectureInferrer, and
 * SymbolExtractor. Implements IPortalKnowledgeService with quick/standard/deep
 * modes, in-memory staleness check, and async background re-analysis on stale cache.
 * @architectural-layer Services
 * * @related-files [src/services/portal_knowledge/mod.ts, src/shared/interfaces/i_portal_knowledge_service.ts]
 */

import { join } from "@std/path";
import { analyzeDirectory, walkDirectory } from "./directory_analyzer.ts";
import { parseConfigFiles } from "./config_parser.ts";
import { identifyKeyFiles } from "./key_file_identifier.ts";
import { detectPatterns } from "./pattern_detector.ts";
import { ArchitectureInferrer, type IArchitectureValidator } from "./architecture_inferrer.ts";
import { type IDocCommandRunner, SymbolExtractor } from "./symbol_extractor.ts";
import type {
  IPortalKnowledgeConfig,
  IPortalKnowledgeService,
} from "../../shared/interfaces/i_portal_knowledge_service.ts";
import type { IPortalKnowledge } from "../../shared/schemas/portal_knowledge.ts";
import type { IModelProvider } from "../../ai/types.ts";
import type { IDatabaseService } from "../../shared/interfaces/i_database_service.ts";
import type { IMemoryBankService } from "../../shared/interfaces/i_memory_bank_service.ts";
import { PortalAnalysisMode } from "../../shared/enums.ts";
import { DEFAULT_IGNORE_PATTERNS } from "../../shared/constants.ts";

// ---------------------------------------------------------------------------
// PortalKnowledgeService
// ---------------------------------------------------------------------------

/** Multiplier applied to maxFilesToRead for `deep` mode analysis. */
const _DEEP_MODE_FILE_CAP_MULTIPLIER = 3;

/** How many files' content are passed to PatternDetector in `standard` mode. */
const PATTERN_DETECTOR_SAMPLE_SIZE = 10;

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
  private readonly _db?: IDatabaseService;
  private readonly _symbolRunner: IDocCommandRunner | undefined;

  /** In-memory cache: alias → latest IPortalKnowledge. */
  private readonly _cache: Map<string, IPortalKnowledge> = new Map();

  constructor(
    config: IPortalKnowledgeConfig,
    memoryBank: IMemoryBankService,
    provider?: IModelProvider,
    validator?: IArchitectureValidator,
    db?: IDatabaseService,
    runner?: IDocCommandRunner,
  ) {
    this._config = config;
    this._memoryBank = memoryBank;
    this._provider = provider;
    this._validator = validator;
    this._db = db;
    this._symbolRunner = runner;
    // memoryBank is stored for use in Step 10 (persistence)
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
      const sampleFiles = fileList.slice(0, PATTERN_DETECTOR_SAMPLE_SIZE);
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
      );
      architectureOverview = await inferrer.infer({
        portalPath,
        directoryTree: fileList,
        keyFiles,
        conventions,
        configSummary: configResult.techStack
          ? `Lang: ${primaryLanguage}, Framework: ${configResult.techStack.framework ?? "none"}`
          : "",
        dependencySummary: (configResult.dependencies ?? [])
          .flatMap((d) => d.keyDependencies)
          .slice(0, 5)
          .map((d) => `${d.name}@${d.version ?? "?"}`)
          .join(", "),
      });
    }

    // Strategy 6: symbol extraction (standard/deep + TS/JS)
    let symbolMap: IPortalKnowledge["symbolMap"] = [];
    if (resolvedMode !== PortalAnalysisMode.QUICK) {
      const extractor = this._symbolRunner ? new SymbolExtractor(this._symbolRunner) : new SymbolExtractor();
      const entrypoints = keyFiles
        .filter((kf) => kf.role === "entrypoint")
        .map((kf) => kf.path);
      if (entrypoints.length === 0 && fileList.length > 0) {
        entrypoints.push(fileList[0]);
      }
      symbolMap = await extractor.extractSymbols(portalPath, entrypoints, {
        primaryLanguage,
        allFilePaths: fileList,
      });
    }

    // Compute filesRead estimate (key files + pattern detector sample)
    const filesRead = Math.min(
      keyFiles.length + PATTERN_DETECTOR_SAMPLE_SIZE,
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
      stats: dirResult.stats ?? {
        totalFiles: fileList.length,
        totalDirectories: 0,
        extensionDistribution: {},
      },
      metadata: {
        durationMs: Date.now() - startMs,
        mode: resolvedMode,
        filesScanned: fileList.length,
        filesRead,
      },
    };

    this._cache.set(portalAlias, knowledge);

    // Log activity
    this._db?.logActivity(
      "portal-knowledge-service",
      "portal.analyzed",
      portalAlias,
      {
        mode: resolvedMode,
        filesScanned: fileList.length,
        durationMs: knowledge.metadata.durationMs,
      },
    );

    return knowledge;
  }

  isStale(portalAlias: string): Promise<boolean> {
    const cached = this._cache.get(portalAlias);
    if (!cached) return Promise.resolve(true);
    const cutoff = new Date(Date.now() - this._config.staleness * 60 * 60 * 1000);
    return Promise.resolve(new Date(cached.gatheredAt) < cutoff);
  }

  async getOrAnalyze(
    portalAlias: string,
    portalPath: string,
  ): Promise<IPortalKnowledge> {
    const cached = this._cache.get(portalAlias);

    if (!cached) {
      // Code path 3: no cache — analyze synchronously
      return this.analyze(portalAlias, portalPath);
    }

    if (!(await this.isStale(portalAlias))) {
      // Code path 1: fresh cache — return immediately
      return cached;
    }

    // Code path 2: stale cache — return stale knowledge immediately,
    // fire async background re-analysis (never blocks the caller)
    this.analyze(portalAlias, portalPath).catch(() => {
      // Silently swallow background errors
    });

    return cached;
  }

  updateKnowledge(
    portalAlias: string,
    portalPath: string,
    _changedFiles?: string[],
  ): Promise<IPortalKnowledge> {
    return this.analyze(portalAlias, portalPath, this._config.defaultMode);
  }
}
