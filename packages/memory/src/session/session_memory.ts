/**
 * @module SessionMemory
 * @path packages/memory/src/session/session_memory.ts
 * @description Integrates with Memory Bank to provide automatic semantic memory lookup and context enhancement for agent execution.
 * @architectural-layer Services
 * @related-files ["packages/memory/src/bank/memory_bank.ts", "packages/execution/src/agent_runner.ts"]
 */

import { z } from "zod";
import type { IMemoryBankService } from "@exaix/core/types";
import type { IMemoryEmbeddingService } from "@exaix/core/types";
import type { IEmbeddingSearchResult } from "@exaix/core/types";
import type { ILearning, IMemorySearchResult } from "@exaix/schemas/memory_bank.ts";
import { type ITemporalCandidate, rankByTemporalRelevance } from "../temporal/temporal_scoring.ts";
import { fuseHybridScores } from "../hybrid/hybrid_fusion.ts";
import { overviewEmbeddingId } from "../embedding/embeddable_entry.ts";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import {
  DEFAULT_MEMORY_CONTEXT_CHAR_LIMIT,
  MEMORY_HYBRID_VECTOR_WEIGHT,
  MEMORY_LINK_EXPANSION_SCORE_FACTOR,
  MEMORY_TEMPORAL_RECENCY_HALF_LIFE_DAYS,
  SESSION_MEMORY_INSIGHT_DESCRIPTION_MAX_CHARS,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
} from "@exaix/core";
import { ConfidenceLevel, LearningCategory, MemoryType } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { ITieredMemoryEntry } from "@exaix/core/types";
import {
  MEMORY_TIER_EPISODIC_PROMOTION_THRESHOLD,
  MEMORY_TIER_PROMOTION_SCORE_HIGH,
  MEMORY_TIER_PROMOTION_SCORE_LOW,
  MEMORY_TIER_PROMOTION_SCORE_MEDIUM,
  MEMORY_TIER_SEMANTIC_PROMOTION_ACCESS_COUNT,
  MEMORY_TIER_SEMANTIC_PROMOTION_QUALITY_ACCESS_FLOOR,
  MemoryTier,
} from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

// Configuration Schema

/**
 * Session memory configuration
 */
export const SessionMemoryConfigSchema = z.object({
  enabled: z.boolean().default(true).describe("Whether session memory is enabled"),
  topK: z.number().min(1).max(20).default(5).describe("Number of memories to retrieve"),
  threshold: z.number().min(0).max(1).default(0.3).describe("Minimum similarity threshold"),
  includeExecutions: z.boolean().default(true).describe("Include execution history in search"),
  includeLearnings: z.boolean().default(true).describe("Include learnings in search"),
  includePatterns: z.boolean().default(true).describe("Include patterns in search"),
  maxContextLength: z.number().default(DEFAULT_MEMORY_CONTEXT_CHAR_LIMIT).describe(
    "Maximum characters for memory context",
  ),
  expandLinks: z.boolean().default(false).describe(
    "Expand the selected results by one hop along learning links, re-scored and deduped",
  ),
});

export type SessionMemoryConfig = z.infer<typeof SessionMemoryConfigSchema>;

// Memory Context Schema

/**
 * A memory item retrieved for context injection
 */
export const MemoryItemSchema = z.object({
  type: z.nativeEnum(MemoryType),
  title: z.string(),
  content: z.string(),
  relevance: z.number().min(0).max(1),
  source: z.string().optional().describe("Where this memory came from"),
  tags: z.array(z.string()).optional(),
});

export type MemoryItem = z.infer<typeof MemoryItemSchema>;

/**
 * Enhanced request with memory context
 */
export const EnhancedRequestSchema = z.object({
  originalRequest: z.string().describe("The original request content"),
  memories: z.array(MemoryItemSchema).describe("Retrieved relevant memories"),
  memoryContext: z.string().describe("Formatted memory context for agent prompt"),
  metadata: z.object({
    memoriesRetrieved: z.number(),
    searchTime: z.number().describe("Time taken for search in ms"),
    queryTerms: z.array(z.string()).optional(),
  }),
});

export type EnhancedRequest = z.infer<typeof EnhancedRequestSchema>;

/**
 * New insight to save after agent execution
 */
export const InsightSchema = z.object({
  title: z.string().max(100),
  description: z.string().max(SESSION_MEMORY_INSIGHT_DESCRIPTION_MAX_CHARS),
  category: z.nativeEnum(LearningCategory),
  tags: z.array(z.string()).max(10),
  confidence: z.nativeEnum(ConfidenceLevel),
  portal: z.string().optional().describe("Project scope, if any"),
  /** Identity of the APPROVED learning this insight mirrors (approval-fed tiered entries). */
  learning_id: z.string().optional(),
});

export type Insight = z.infer<typeof InsightSchema>;

/**
 * Result of saving an insight
 */
export const SaveInsightResultSchema = z.object({
  success: z.boolean(),
  learningId: z.string().optional(),
  message: z.string(),
});

export type SaveInsightResult = z.infer<typeof SaveInsightResultSchema>;

// Default Configuration

export const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryConfig = {
  enabled: true,
  topK: 5,
  threshold: 0.3,
  includeExecutions: true,
  includeLearnings: true,
  includePatterns: true,
  maxContextLength: DEFAULT_MEMORY_CONTEXT_CHAR_LIMIT,
  expandLinks: false,
};

// Session Memory Service

export class SessionMemoryService {
  private config: SessionMemoryConfig;
  private _tieredEntries: Map<string, ITieredMemoryEntry> = new Map();
  private tieredEntriesLoaded = false;

  constructor(
    private memoryBank: IMemoryBankService,
    private embeddingService: IMemoryEmbeddingService,
    config?: Opt<Partial<SessionMemoryConfig>, Reason.FactoryPreset>,
    private tieredEntriesPath?: Opt<string, Reason.ExecutionConfig>,
    private readonly logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ) {
    this.config = { ...DEFAULT_SESSION_MEMORY_CONFIG, ...config };
  }

  private async ensureTieredEntriesLoaded(): Promise<void> {
    if (this.tieredEntriesLoaded || !this.tieredEntriesPath) return;
    const p = this.tieredEntriesPath;
    if (p.length === 0 || p === "/" || p === "\\") {
      throw new Error(`Invalid tieredEntriesPath: "${p}" — must be a non-empty, non-root absolute path`);
    }
    if (await exists(p)) {
      const content = await Deno.readTextFile(p);
      const entries = JSON.parse(content) as Array<[string, ITieredMemoryEntry]>;
      this._tieredEntries = new Map(entries);
    }
    this.tieredEntriesLoaded = true;
  }

  private async persistTieredEntries(): Promise<void> {
    if (!this.tieredEntriesPath) return;
    const p = this.tieredEntriesPath;
    if (p.length === 0 || p === "/" || p === "\\") {
      throw new Error(`Invalid tieredEntriesPath: "${p}" — must be a non-empty, non-root absolute path`);
    }
    await ensureDir(join(p, ".."));
    const entries = Array.from(this._tieredEntries.entries());
    await Deno.writeTextFile(p, JSON.stringify(entries, null, 2));
  }

  async lookupMemories(
    query: string,
    tokenCap?: Opt<number, Reason.ExecutionConfig>,
    options?: Opt<Partial<SessionMemoryConfig>, Reason.ExecutionConfig>,
  ): Promise<MemoryItem[]> {
    const cfg = { ...this.config, ...options };

    if (!cfg.enabled) {
      return [];
    }

    // Hybrid retrieval: collect both signals keyed by candidate identity, then fuse.
    const itemsByIdentity = new Map<string, MemoryItem>();
    const vectorScores = new Map<string, number>();
    const keywordScores = new Map<string, number>();

    await this.collectVectorSignal(query, cfg, itemsByIdentity, vectorScores);
    await this.collectKeywordSignal(query, cfg, itemsByIdentity, keywordScores);

    // Fuse: items surfaced by both signals accumulate score and outrank single-signal items;
    // when embeddings are unavailable the keyword signal alone still populates results (floor).
    const keywordWeight = 1 - MEMORY_HYBRID_VECTOR_WEIGHT;
    const fused = fuseHybridScores(vectorScores, keywordScores, MEMORY_HYBRID_VECTOR_WEIGHT, keywordWeight);

    const memories: MemoryItem[] = [];
    for (const [identity, item] of itemsByIdentity) {
      item.relevance = fused.get(identity) ?? item.relevance;
      memories.push(item);
    }

    // Apply tier-based relevance boost for hierarchical memory prioritization
    const tierBoost = this._computeTierBoosts();

    for (const memory of memories) {
      const learningId = this._extractLearningId(memory);
      if (learningId && tierBoost.has(learningId)) {
        memory.relevance += tierBoost.get(learningId)!;
        memory.relevance = Math.min(memory.relevance, 1.0);
      }
    }

    // Sort by relevance and limit
    memories.sort((a, b) => b.relevance - a.relevance);

    const selected = memories.slice(0, cfg.topK);
    const expanded = cfg.expandLinks ? await this.expandByLinks(selected) : selected;

    if (tokenCap !== undefined) {
      return this.applyTokenCap(expanded, tokenCap);
    }

    return expanded;
  }

  /** Expands the selected results by one hop along learning links: linked APPROVED learnings are appended re-scored and deduplicated (cycle-safe — one hop, no recursion). */
  private async expandByLinks(selected: MemoryItem[]): Promise<MemoryItem[]> {
    const result = [...selected];
    const seenSources = new Set(selected.map((item) => item.source));
    const globalMem = await this.memoryBank.getGlobalMemory();
    const learningById = new Map(
      (globalMem?.learnings ?? []).map((learning) => [learning.id, learning]),
    );

    for (const item of selected) {
      const learningId = this._extractLearningId(item);
      if (!learningId) continue;
      const source = learningById.get(learningId);
      for (const link of source?.links ?? []) {
        const target = learningById.get(link.target_id);
        if (!target || target.status !== MemoryStatus.APPROVED) continue;
        const targetSource = `${MemoryType.LEARNING}:${target.id}`;
        if (seenSources.has(targetSource)) continue;
        seenSources.add(targetSource);
        result.push({
          type: MemoryType.LEARNING,
          title: target.title,
          content: target.description,
          relevance: Math.min(1, item.relevance * MEMORY_LINK_EXPANSION_SCORE_FACTOR),
          source: targetSource,
          tags: target.tags,
        });
      }
    }
    return result;
  }

  /** Collects the vector signal over the embedding index (all embedded kinds; learning-kind candidates are APPROVED-filtered and temporally ranked before fusion). */
  private async collectVectorSignal(
    query: string,
    cfg: SessionMemoryConfig,
    itemsByIdentity: Map<string, MemoryItem>,
    vectorScores: Map<string, number>,
  ): Promise<void> {
    if (!cfg.includeLearnings && !cfg.includePatterns && !cfg.includeExecutions) {
      return;
    }
    const embeddingResults = await this.embeddingService.searchByEmbedding(query, {
      limit: cfg.topK,
      threshold: cfg.threshold,
    });
    const learningLike = embeddingResults.filter((r) => r.kind === undefined || r.kind === MemoryType.LEARNING);
    const nonLearning = embeddingResults.filter((r) => r.kind !== undefined && r.kind !== MemoryType.LEARNING);

    for (const result of await this.temporallyRank(learningLike)) {
      const identity = `${MemoryType.LEARNING}:${result.id}`;
      itemsByIdentity.set(identity, {
        type: MemoryType.LEARNING,
        title: result.title,
        content: result.summary,
        relevance: result.similarity,
        source: `learning:${result.id}`,
      });
      vectorScores.set(identity, result.similarity);
    }
    for (const result of nonLearning) {
      if (!result.kind || !this.shouldIncludeVectorKind(result.kind, cfg)) continue;
      const { identity, item } = this.vectorResultToItem(result);
      itemsByIdentity.set(identity, item);
      vectorScores.set(identity, result.similarity);
    }
  }

  /** Collects the keyword signal over the memory bank, joining vector-shared candidates by identity. */
  private async collectKeywordSignal(
    query: string,
    cfg: SessionMemoryConfig,
    itemsByIdentity: Map<string, MemoryItem>,
    keywordScores: Map<string, number>,
  ): Promise<void> {
    const searchResults = await this.memoryBank.searchMemory(query, {
      limit: cfg.topK * 2, // Get more to filter
    });

    // searchMemory omits global learnings; searchByKeyword covers them (APPROVED-filtered),
    // so keep just its learning results (its project/decision hits duplicate the above).
    const globalLearningResults = cfg.includeLearnings
      ? (await this.memoryBank.searchByKeyword(query, { limit: cfg.topK * 2 }))
        .filter((result) => result.type === MemoryType.LEARNING)
      : [];

    for (const result of [...searchResults, ...globalLearningResults]) {
      if (!this.shouldIncludeSearchResult(result.type, cfg)) {
        continue;
      }
      const identity = this.keywordResultIdentity(result);
      if (!itemsByIdentity.has(identity)) {
        itemsByIdentity.set(identity, {
          type: this.mapResultType(result.type),
          title: result.title,
          content: result.summary,
          relevance: result.relevance_score || 0.5,
          source: result.trace_id
            ? `execution:${result.trace_id}`
            : result.id
            ? `${result.type}:${result.id}`
            : `${result.type}:${result.title}`,
          tags: result.tags,
        });
      }
      keywordScores.set(identity, result.relevance_score || 0.5);
    }
  }

  /**
   * Determine if a search result should be included based on configuration
   */
  private shouldIncludeSearchResult(
    resultType: string,
    cfg: SessionMemoryConfig,
  ): boolean {
    if (resultType === MemoryType.EXECUTION && !cfg.includeExecutions) {
      return false;
    }
    if (resultType === MemoryType.PATTERN && !cfg.includePatterns) {
      return false;
    }
    return true;
  }

  /** Include-flag gate for non-learning vector candidates; decisions and overviews have no flag. */
  private shouldIncludeVectorKind(kind: MemoryType, cfg: SessionMemoryConfig): boolean {
    if (kind === MemoryType.PATTERN) return cfg.includePatterns;
    if (kind === MemoryType.EXECUTION) return cfg.includeExecutions;
    return true;
  }

  /** Maps a non-learning embedding result to its fusion identity (joined against the keyword signal) and MemoryItem. */
  private vectorResultToItem(
    result: IEmbeddingSearchResult,
  ): { agent_role: string; item: MemoryItem } {
    switch (result.kind) {
      case MemoryType.PATTERN:
        return {
          agent_role: `${MemoryType.PATTERN}:${result.id}`,
          item: {
            type: MemoryType.PATTERN,
            title: result.title,
            content: result.summary,
            relevance: result.similarity,
            source: `${MemoryType.PATTERN}:${result.id}`,
          },
        };
      case MemoryType.DECISION:
        return {
          agent_role: `${MemoryType.DECISION}:${result.id}`,
          item: {
            type: MemoryType.DECISION,
            title: result.title,
            content: result.summary,
            relevance: result.similarity,
            source: `${MemoryType.DECISION}:${result.id}`,
          },
        };
      case MemoryType.EXECUTION:
        return {
          agent_role: `${MemoryType.EXECUTION}:${result.id}`,
          item: {
            type: MemoryType.EXECUTION,
            title: result.title,
            content: result.summary,
            relevance: result.similarity,
            source: `${MemoryType.EXECUTION}:${result.id}`,
          },
        };
      case MemoryType.PROJECT:
        return {
          agent_role: result.id,
          item: {
            type: MemoryType.PROJECT,
            title: result.title,
            content: result.summary,
            relevance: result.similarity,
            source: `${MemoryType.PROJECT}:${result.title}`,
          },
        };
      default:
        return {
          agent_role: `insight:${result.id}`,
          item: {
            type: MemoryType.INSIGHT,
            title: result.title,
            content: result.summary,
            relevance: result.similarity,
            source: `${MemoryType.INSIGHT}:${result.id}`,
          },
        };
    }
  }

  /** Fusion identity for a keyword-search result: stamped ids join pattern/decision vector hits, trace_id joins executions, and project overviews join via their synthetic key. */
  private keywordResultIdentity(result: IMemorySearchResult): string {
    if (result.id) {
      return `${result.type}:${result.id}`;
    }
    if (result.type === MemoryType.EXECUTION && result.trace_id) {
      return `${MemoryType.EXECUTION}:${result.trace_id}`;
    }
    if (result.type === MemoryType.PROJECT && result.portal) {
      return overviewEmbeddingId(result.portal);
    }
    return `keyword:${result.type}:${result.title}`;
  }

  /**
   * Apply token cap to memories
   */
  private applyTokenCap(memories: MemoryItem[], tokenCap: number): MemoryItem[] {
    const charBudget = tokenCap * TOKEN_ESTIMATION_CHARS_PER_TOKEN;
    const cappedMemories: MemoryItem[] = [];
    let usedChars = 0;

    for (const memory of memories) {
      const entryLength = this.formatMemoryItem(memory).length + 2;
      if (usedChars + entryLength > charBudget) {
        break;
      }
      cappedMemories.push(memory);
      usedChars += entryLength;
    }

    return cappedMemories;
  }
  async enhanceRequest(
    request: string,
    options?: Opt<Partial<SessionMemoryConfig>, Reason.ExecutionConfig>,
  ): Promise<EnhancedRequest> {
    const cfg = { ...this.config, ...options };
    const startTime = performance.now();

    if (!cfg.enabled) {
      return {
        originalRequest: request,
        memories: [],
        memoryContext: "",
        metadata: {
          memoriesRetrieved: 0,
          searchTime: 0,
        },
      };
    }

    // Extract key terms for better search
    const queryTerms = this.extractKeyTerms(request);

    // Lookup memories
    const tokenCap = Math.floor(cfg.maxContextLength / TOKEN_ESTIMATION_CHARS_PER_TOKEN);
    const memories = await this.lookupMemories(request, tokenCap, cfg);

    // Format memory context
    const memoryContext = this.formatMemoryContext(memories, cfg.maxContextLength);

    const searchTime = performance.now() - startTime;

    return {
      originalRequest: request,
      memories,
      memoryContext,
      metadata: {
        memoriesRetrieved: memories.length,
        searchTime,
        queryTerms,
      },
    };
  }

  /** Adds an insight to tiered working memory for promotion tracking only: no global-bank
   *  write and no embedding — the durable copy and embedding of reviewed learnings are
   *  owned by the approval pipeline. */
  async saveInsight(insight: Insight): Promise<SaveInsightResult> {
    await this.ensureTieredEntriesLoaded();
    try {
      InsightSchema.parse(insight);

      const entryId = insight.learning_id ?? crypto.randomUUID();
      this._tieredEntries.set(entryId, {
        id: entryId,
        content: insight.description || insight.title,
        tier: MemoryTier.WORKING,
        source: { planId: "", stepId: "" },
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 1,
        promotionScore: insight.confidence === ConfidenceLevel.HIGH
          ? MEMORY_TIER_PROMOTION_SCORE_HIGH
          : insight.confidence === ConfidenceLevel.MEDIUM
          ? MEMORY_TIER_PROMOTION_SCORE_MEDIUM
          : MEMORY_TIER_PROMOTION_SCORE_LOW,
      });

      await this.persistTieredEntries();

      return {
        success: true,
        learningId: entryId,
        message: `Insight added to tiered working memory with ID ${entryId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to save insight: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /** SEMANTIC entries are never auto-demoted. */
  async promoteMemories(): Promise<number> {
    let promotedCount = 0;

    await this.ensureTieredEntriesLoaded();

    for (const [, entry] of this._tieredEntries) {
      if (
        entry.tier === MemoryTier.WORKING &&
        entry.promotionScore >= MEMORY_TIER_EPISODIC_PROMOTION_THRESHOLD
      ) {
        entry.tier = MemoryTier.EPISODIC;
        promotedCount++;
      } else if (
        entry.tier === MemoryTier.EPISODIC &&
        (entry.accessCount >= MEMORY_TIER_SEMANTIC_PROMOTION_ACCESS_COUNT ||
          // Value-based complement: high-quality entries promote on fewer accesses.
          (entry.promotionScore >= MEMORY_TIER_PROMOTION_SCORE_HIGH &&
            entry.accessCount >= MEMORY_TIER_SEMANTIC_PROMOTION_QUALITY_ACCESS_FLOOR))
      ) {
        entry.tier = MemoryTier.SEMANTIC;
        promotedCount++;
      }
    }

    if (promotedCount > 0) {
      await this.persistTieredEntries();
      this.logger?.info(
        DomainEventType.MemoryTierPromotion,
        MemoryTier.SEMANTIC,
        { promoted: promotedCount },
      );
    }

    return promotedCount;
  }

  /** @param index - 1-based index into the tiered entries (not 0-based). */
  async accessMemory(index: number): Promise<void> {
    await this.ensureTieredEntriesLoaded();
    const keys = Array.from(this._tieredEntries.keys());
    if (index < 1 || index > keys.length) return;
    const key = keys[index - 1];
    const entry = this._tieredEntries.get(key);
    if (entry) {
      entry.accessCount++;
      entry.lastAccessedAt = Date.now();
      await this.persistTieredEntries();
    }
  }

  async saveInsights(insights: Insight[]): Promise<SaveInsightResult[]> {
    const results: SaveInsightResult[] = [];
    for (const insight of insights) {
      const result = await this.saveInsight(insight);
      results.push(result);
    }
    return results;
  }
  async getMemoriesByTag(
    tags: string[],
    options?: Opt<Partial<SessionMemoryConfig>, Reason.ExecutionConfig>,
  ): Promise<MemoryItem[]> {
    const cfg = { ...this.config, ...options };

    const results = await this.memoryBank.searchByTags(tags, {
      limit: cfg.topK,
    });

    return results.map((result) => ({
      type: this.mapResultType(result.type),
      title: result.title,
      content: result.summary,
      relevance: result.relevance_score || 0.8,
      source: `${result.type}:${result.title}`,
      tags: result.tags,
    }));
  }

  async getRecentExecutions(
    portal?: Opt<string, Reason.OptionalContext>,
    limit: number = 5,
  ): Promise<MemoryItem[]> {
    const executions = await this.memoryBank.getExecutionHistory(portal, limit);

    return executions.map((exec) => ({
      type: MemoryType.EXECUTION,
      title: `Execution: ${exec.trace_id.slice(0, 8)}`,
      content: exec.summary,
      relevance: 1.0, // Recent executions are always relevant
      source: `execution:${exec.trace_id}`,
    }));
  }

  updateConfig(config: Partial<SessionMemoryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): SessionMemoryConfig {
    return { ...this.config };
  }

  // Private Helper Methods

  /** Re-ranks embedding-index candidates against bank records: only APPROVED learnings rank (the index is status-blind), re-weighted by recency half-life; candidates with no bank record are excluded; title/content stay as the index reported them. */
  private async temporallyRank(results: IEmbeddingSearchResult[]): Promise<IEmbeddingSearchResult[]> {
    const globalMem = await this.memoryBank.getGlobalMemory();
    const learningById = new Map<string, ILearning>(
      (globalMem?.learnings ?? []).map((learning) => [learning.id, learning]),
    );
    const candidates: ITemporalCandidate[] = [];
    for (const result of results) {
      const learning = learningById.get(result.id);
      if (learning) {
        candidates.push({ id: result.id, baseScore: result.similarity, learning });
      }
    }
    const ranked = rankByTemporalRelevance(candidates, {
      now: new Date(),
      halfLifeDays: MEMORY_TEMPORAL_RECENCY_HALF_LIFE_DAYS,
    });
    const resultById = new Map(results.map((result) => [result.id, result]));
    return ranked.map((candidate) => ({ ...resultById.get(candidate.id)!, similarity: candidate.baseScore }));
  }

  /**
   * Extract key terms from a query for better search
   */
  private extractKeyTerms(query: string): string[] {
    // Simple extraction - split on whitespace and filter short words
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "must",
      "shall",
      "can",
      "need",
      "to",
      "of",
      "in",
      "for",
      "on",
      "with",
      "at",
      "by",
      "from",
      "as",
      "into",
      "through",
      "during",
      "before",
      "after",
      "above",
      "below",
      "between",
      "under",
      "again",
      "further",
      "then",
      "once",
      "here",
      "there",
      "when",
      "where",
      "why",
      "how",
      "all",
      "each",
      "few",
      "more",
      "most",
      "other",
      "some",
      "such",
      "no",
      "nor",
      "not",
      "only",
      "own",
      "same",
      "so",
      "than",
      "too",
      "very",
      "just",
      "and",
      "but",
      "if",
      "or",
      "because",
      "until",
      "while",
      "this",
      "that",
      "these",
      "those",
    ]);

    const words = query.toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    // Return unique terms
    return [...new Set(words)];
  }

  /**
   * Format memory items into context string
   */
  private formatMemoryContext(memories: MemoryItem[], maxLength: number): string {
    if (memories.length === 0) {
      return "";
    }

    const lines: string[] = [];
    let currentLength = 0;

    for (const memory of memories) {
      const entry = this.formatMemoryItem(memory);
      if (currentLength + entry.length > maxLength) {
        break;
      }
      lines.push(entry);
      currentLength += entry.length + 2; // +2 for newlines
    }

    return lines.join("\n\n");
  }

  /**
   * Format a single memory item
   */
  private formatMemoryItem(memory: MemoryItem): string {
    const relevancePercent = Math.round(memory.relevance * 100);
    const tags = memory.tags?.length ? ` [${memory.tags.join(", ")}]` : "";

    return `### ${memory.type.charAt(0).toUpperCase() + memory.type.slice(1)}: ${memory.title}${tags}
**Relevance:** ${relevancePercent}%
${memory.content}`;
  }

  /**
   * Map memory search result type to memory item type
   */
  private mapResultType(
    type: IMemorySearchResult["type"],
  ): MemoryItem["type"] {
    switch (type) {
      case MemoryType.LEARNING:
        return MemoryType.LEARNING;
      case MemoryType.PATTERN:
        return MemoryType.PATTERN;
      case MemoryType.DECISION:
        return MemoryType.DECISION;
      case MemoryType.EXECUTION:
        return MemoryType.EXECUTION;
      default:
        return MemoryType.INSIGHT;
    }
  }

  private _computeTierBoosts(): Map<string, number> {
    const boosts = new Map<string, number>();
    for (const [id, entry] of this._tieredEntries) {
      switch (entry.tier) {
        case MemoryTier.WORKING:
          boosts.set(id, 0.3);
          break;
        case MemoryTier.EPISODIC:
          boosts.set(id, 0.2);
          break;
        case MemoryTier.SEMANTIC:
          boosts.set(id, 0.1);
          break;
      }
    }
    return boosts;
  }

  private _extractLearningId(memory: MemoryItem): string | undefined {
    if (!memory.source) return undefined;
    const match = memory.source.match(/^learning:(.+)$/);
    return match?.[1];
  }
}
