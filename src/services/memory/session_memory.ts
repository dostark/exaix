/**
 * @module SessionMemory
 * @path src/services/memory/session_memory.ts
 * @description Integrates with Memory Bank to provide automatic semantic memory lookup and context enhancement for agent execution.
 * @architectural-layer Services
 * * @related-files [src/services/memory_bank.ts, src/services/agent_runner.ts]
 */

import { z } from "zod";
import type { IMemoryBankService } from "../../shared/interfaces/i_memory_bank_service.ts";
import type { IMemoryEmbeddingService } from "./memory_embedding.ts";
import type { ILearning, IMemorySearchResult } from "@exaix/schemas/memory_bank.ts";
import {
  DEFAULT_MEMORY_CONTEXT_CHAR_LIMIT,
  SESSION_MEMORY_INSIGHT_DESCRIPTION_MAX_CHARS,
  TOKEN_ESTIMATION_CHARS_PER_TOKEN,
} from "@exaix/core";
import {
  ConfidenceAssessmentLevel,
  ConfidenceLevel,
  LearningCategory,
  MemoryBankSource,
  MemoryScope,
  MemoryType,
} from "@exaix/core";
import { MemoryStatus } from "@exaix/core";

function mapConfidenceLevelToAssessment(
  confidence: ConfidenceLevel,
): ConfidenceAssessmentLevel {
  switch (confidence) {
    case ConfidenceLevel.HIGH:
      return ConfidenceAssessmentLevel.HIGH;
    case ConfidenceLevel.MEDIUM:
      return ConfidenceAssessmentLevel.MEDIUM;
    case ConfidenceLevel.LOW:
    default:
      return ConfidenceAssessmentLevel.LOW;
  }
}

// ===== Configuration Schema =====

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
});

export type SessionMemoryConfig = z.infer<typeof SessionMemoryConfigSchema>;

// ===== Memory Context Schema =====

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

// ===== Default Configuration =====

export const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryConfig = {
  enabled: true,
  topK: 5,
  threshold: 0.3,
  includeExecutions: true,
  includeLearnings: true,
  includePatterns: true,
  maxContextLength: DEFAULT_MEMORY_CONTEXT_CHAR_LIMIT,
};

// ===== Session Memory Service =====

/**
 * Session Memory Service
 *
 * Provides automatic memory lookup and context enhancement for agent execution.
 * Integrates with MemoryBankService for data storage and MemoryEmbeddingService
 * for semantic search.
 */
export class SessionMemoryService {
  private config: SessionMemoryConfig;

  constructor(
    private memoryBank: IMemoryBankService,
    private embeddingService: IMemoryEmbeddingService,
    config?: Partial<SessionMemoryConfig>,
  ) {
    this.config = { ...DEFAULT_SESSION_MEMORY_CONFIG, ...config };
  }

  /**
   * Look up relevant memories for a request
   *
   * Performs semantic search across memory bank to find relevant past
   * interactions, learnings, and patterns.
   *
   * @param query - The request or query to find memories for
   * @param options - Optional override configuration
   * @returns Array of relevant memory items
   */
  async lookupMemories(
    query: string,
    tokenCap?: number,
    options?: Partial<SessionMemoryConfig>,
  ): Promise<MemoryItem[]> {
    const cfg = { ...this.config, ...options };

    if (!cfg.enabled) {
      return [];
    }

    const memories: MemoryItem[] = [];

    // Perform embedding-based semantic search on learnings
    if (cfg.includeLearnings) {
      const embeddingResults = await this.embeddingService.searchByEmbedding(query, {
        limit: cfg.topK,
        threshold: cfg.threshold,
      });

      for (const result of embeddingResults) {
        memories.push({
          type: MemoryType.LEARNING,
          title: result.title,
          content: result.summary,
          relevance: result.similarity,
          source: `learning:${result.id}`,
        });
      }
    }

    // Perform keyword search on memory bank
    const searchResults = await this.memoryBank.searchMemory(query, {
      limit: cfg.topK * 2, // Get more to filter
    });

    for (const result of searchResults) {
      // Skip if we already have this from embedding search
      if (memories.some((m) => m.source === `${result.type}:${result.trace_id || result.title}`)) {
        continue;
      }

      if (!this.shouldIncludeSearchResult(result.type, cfg)) {
        continue;
      }

      memories.push({
        type: this.mapResultType(result.type),
        title: result.title,
        content: result.summary,
        relevance: result.relevance_score || 0.5,
        source: result.trace_id ? `execution:${result.trace_id}` : `${result.type}:${result.title}`,
        tags: result.tags,
      });
    }

    // Sort by relevance and limit
    memories.sort((a, b) => b.relevance - a.relevance);

    if (tokenCap !== undefined) {
      return this.applyTokenCap(memories, tokenCap);
    }

    return memories.slice(0, cfg.topK);
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
  /**
   * Looks up memories and formats them into a context string that can be
   * injected into agent prompts.
   *
   * @param request - The original request
   * @param options - Optional configuration overrides
   * @returns Enhanced request with memory context
   */
  async enhanceRequest(
    request: string,
    options?: Partial<SessionMemoryConfig>,
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

  /**
   * Save an insight from agent execution to memory
   *
   * Creates a new learning entry in the memory bank that can be retrieved
   * in future sessions.
   *
   * @param insight - The insight to save
   * @returns Save result with learning ID if successful
   */
  async saveInsight(insight: Insight): Promise<SaveInsightResult> {
    try {
      // Validate insight
      InsightSchema.parse(insight);

      // Create learning entry
      const learning: ILearning = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        source: MemoryBankSource.IDENTITY,
        scope: insight.portal ? MemoryScope.PROJECT : MemoryScope.GLOBAL,
        project: insight.portal,
        title: insight.title,
        description: insight.description,
        category: insight.category,
        tags: insight.tags,
        confidence: mapConfidenceLevelToAssessment(insight.confidence),
        status: MemoryStatus.PENDING, // Start as pending for review
      };

      // Save to memory bank
      await this.memoryBank.addGlobalLearning(learning);

      // Generate embedding for semantic search
      await this.embeddingService.embedLearning(learning);

      return {
        success: true,
        learningId: learning.id,
        message: `Insight saved with ID ${learning.id} (pending approval)`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to save insight: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Save multiple insights from agent execution
   *
   * @param insights - Array of insights to save
   * @returns Array of save results
   */
  async saveInsights(insights: Insight[]): Promise<SaveInsightResult[]> {
    const results: SaveInsightResult[] = [];
    for (const insight of insights) {
      const result = await this.saveInsight(insight);
      results.push(result);
    }
    return results;
  }

  /**
   * Build agent prompt with memory context
   *
   * Convenience method to combine a base prompt with memory context.
   *
   * @param basePrompt - The base agent prompt
   * @param request - The user request
   * @param options - Optional configuration
   * @returns Combined prompt with memory context
   */
  async buildPromptWithMemory(
    basePrompt: string,
    request: string,
    options?: Partial<SessionMemoryConfig>,
  ): Promise<string> {
    const enhanced = await this.enhanceRequest(request, options);

    if (!enhanced.memoryContext) {
      return `${basePrompt}\n\n## User Request\n${request}`;
    }

    return `${basePrompt}\n\n## Relevant Context from Memory\n${enhanced.memoryContext}\n\n## User Request\n${request}`;
  }

  /**
   * Get memories by tag
   *
   * Retrieves memories that match specific tags.
   *
   * @param tags - Tags to search for
   * @param options - Optional configuration
   * @returns Matching memory items
   */
  async getMemoriesByTag(
    tags: string[],
    options?: Partial<SessionMemoryConfig>,
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

  /**
   * Get recent execution memories
   *
   * Retrieves memories from recent executions for a specific portal.
   *
   * @param portal - Portal to get executions for
   * @param limit - Maximum number of executions
   * @returns Memory items from executions
   */
  async getRecentExecutions(
    portal?: string,
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

  /**
   * Update configuration
   *
   * @param config - New configuration values
   */
  updateConfig(config: Partial<SessionMemoryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): SessionMemoryConfig {
    return { ...this.config };
  }

  // ===== Private Helper Methods =====

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
}

// ===== Factory Functions =====

/**
 * Create a SessionMemoryService with default configuration
 */
export function createSessionMemoryService(
  memoryBank: IMemoryBankService,
  embeddingService: IMemoryEmbeddingService,
  config?: Partial<SessionMemoryConfig>,
): SessionMemoryService {
  return new SessionMemoryService(memoryBank, embeddingService, config);
}

/**
 * Create a disabled SessionMemoryService (for testing or opt-out)
 */
export function createDisabledSessionMemoryService(
  memoryBank: IMemoryBankService,
  embeddingService: IMemoryEmbeddingService,
): SessionMemoryService {
  return new SessionMemoryService(memoryBank, embeddingService, { enabled: false });
}
