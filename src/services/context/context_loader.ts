/**
 * @module ContextLoader
 * @path src/services/context/context_loader.ts
 * @description Intelligently loads and prioritizes codebase context for LLM execution.
 *
 * Responsibilities:
 * - Assemble LLM context within token budgets
 * - Prioritize relevant files based on relevance thresholds
 * - Handle portal and workspace directory boundaries
 *
 * @architectural-layer Services
 * * @related-files [src/services/agent_runner.ts]
 */

import type { DatabaseService } from "../core/db.ts";

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Configuration for context loading behavior
 */
export interface IContextConfig {
  /** Maximum tokens allowed (from model config, e.g., 200k for Claude) */
  maxTokens: number;

  /** Safety margin as percentage (0.8 = use 80% of max to leave room for response) */
  safetyMargin: number;

  /** Strategy for handling context that exceeds limits */
  truncationStrategy:
    | "smallest-first"
    | "drop-largest"
    | "drop-oldest"
    | "truncate-each";

  /** Optional: per-file token cap (prevents single huge file from dominating) */
  perFileTokenCap?: number;

  /** Whether this is a local-first agent (no enforced limits) */
  isLocalAgent: boolean;

  /** Optional: Trace ID for activity logging */
  traceId?: string;

  /** Optional: Request ID for activity logging */
  requestId?: string;

  /** Optional: Agent ID for activity logging */
  identityId?: string;

  /** Optional: Database service for activity logging */
  db?: DatabaseService;
}

/**
 * Metadata about a context file
 */
export interface ContextFile {
  /** Absolute path to file */
  path: string;

  /** File content */
  content: string;

  /** File size in bytes */
  sizeBytes: number;

  /** Estimated token count */
  tokenCount: number;

  /** File modification time (for drop-oldest strategy) */
  modifiedAt: Date;

  /** Optional priority override (higher = more important) */
  priority?: number;
}

/**
 * Result of context loading operation
 */
export interface ContextLoadResult {
  /** Combined content ready to inject into prompt */
  content: string;

  /** Warning messages about truncation/skipping */
  warnings: string[];

  /** Total tokens used */
  totalTokens: number;

  /** Files that were included */
  includedFiles: string[];

  /** Files that were skipped */
  skippedFiles: string[];

  /** Files that were truncated */
  truncatedFiles: string[];
}

// ============================================================================
// Context Loader Service
// ============================================================================

/**
 * ContextLoader intelligently loads context files within token budgets,
 * using configurable strategies to prioritize and truncate content.
 */
export class ContextLoader {
  private tokenCounter: (text: string) => number;

  constructor(private config: IContextConfig) {
    // Simple approximation: 1 token ≈ 4 characters
    this.tokenCounter = (text) => Math.ceil(text.length / 4);
  }

  /**
   * Load context files within token budget
   * @param filePaths - Absolute paths to context files
   * @returns Context load result with content and metadata
   */
  async loadWithLimit(filePaths: string[]): Promise<ContextLoadResult> {
    // Short-circuit for local agents with no limits
    if (this.config.isLocalAgent) {
      return await this.loadAllFiles(filePaths);
    }

    const limit = this.config.maxTokens * this.config.safetyMargin;
    const warnings: string[] = [];
    const includedFiles: string[] = [];
    const skippedFiles: string[] = [];
    const truncatedFiles: string[] = [];
    let totalTokens = 0;

    // Step 1: Load and analyze all files
    const contextFiles = await this.loadContextFiles(filePaths);

    // Step 2: Apply per-file token caps if configured
    const cappedFiles = this.applyPerFileCaps(
      contextFiles,
      warnings,
      truncatedFiles,
    );

    // Step 3: Apply truncation strategy
    const sortedFiles = this.applyStrategy(cappedFiles);

    // Step 4: Select files that fit within budget
    const selectedFiles: ContextFile[] = [];

    for (const file of sortedFiles) {
      if (totalTokens + file.tokenCount <= limit) {
        selectedFiles.push(file);
        includedFiles.push(file.path);
        totalTokens += file.tokenCount;
      } else if (this.config.truncationStrategy === "truncate-each") {
        // Try to fit partial content
        const remainingTokens = limit - totalTokens;
        if (remainingTokens > 100) {
          // Only include if we can fit at least 100 tokens (meaningful content)
          const truncated = this.truncateFile(file, remainingTokens);
          selectedFiles.push(truncated);
          includedFiles.push(file.path);
          if (!truncatedFiles.includes(file.path)) {
            truncatedFiles.push(file.path);
          }
          totalTokens += truncated.tokenCount;
          warnings.push(
            `Truncated ${file.path} to ${remainingTokens} tokens (original: ${file.tokenCount})`,
          );
        } else {
          skippedFiles.push(file.path);
          warnings.push(
            `Skipped ${file.path} (${file.tokenCount} tokens, insufficient remaining budget)`,
          );
        }
        break; // Budget exhausted
      } else {
        skippedFiles.push(file.path);
        warnings.push(
          `Skipped ${file.path} (${file.tokenCount} tokens, would exceed limit)`,
        );
      }
    }

    // Step 5: Format context for injection
    const content = this.formatContext(selectedFiles, warnings, limit);

    // Step 6: Log context loading to IActivity Journal
    this.logContextLoad({
      totalTokens,
      includedCount: includedFiles.length,
      skippedCount: skippedFiles.length,
      truncatedCount: truncatedFiles.length,
      strategy: this.config.truncationStrategy,
      isLocalAgent: this.config.isLocalAgent,
    });

    return {
      content,
      warnings,
      totalTokens,
      includedFiles,
      skippedFiles,
      truncatedFiles,
    };
  }

  /**
   * Load all files without limits (for local agents)
   */
  private async loadAllFiles(filePaths: string[]): Promise<ContextLoadResult> {
    const contextFiles = await this.loadContextFiles(filePaths);
    const content = this.formatContext(contextFiles, [], 0);

    return {
      content,
      warnings: [],
      totalTokens: contextFiles.reduce((sum, f) => sum + f.tokenCount, 0),
      includedFiles: filePaths.filter((path) => contextFiles.some((f) => f.path === path)),
      skippedFiles: [],
      truncatedFiles: [],
    };
  }

  /**
   * Load and analyze context files from paths
   */
  private async loadContextFiles(
    filePaths: string[],
  ): Promise<ContextFile[]> {
    const files = await Promise.all(
      filePaths.map(async (path): Promise<ContextFile | null> => {
        try {
          const content = await Deno.readTextFile(path);
          const stat = await Deno.stat(path);

          return {
            path,
            content,
            sizeBytes: stat.size,
            tokenCount: this.tokenCounter(content),
            modifiedAt: stat.mtime ?? new Date(0),
            priority: 0, // Default priority, can be overridden
          };
        } catch (error) {
          // Log file load failure to IActivity Journal
          this.logFileLoadError(path, error);
          // Return null for failed loads, will be filtered out
          return null;
        }
      }),
    );

    // Filter out failed loads and return only successful ones
    return files.filter((f): f is ContextFile => f !== null && f.tokenCount > 0);
  }

  /**
   * Apply per-file token caps
   */
  private applyPerFileCaps(
    files: ContextFile[],
    warnings: string[],
    truncatedFiles: string[],
  ): ContextFile[] {
    if (!this.config.perFileTokenCap) {
      return files;
    }

    return files.map((file) => {
      if (file.tokenCount > this.config.perFileTokenCap!) {
        const truncated = this.truncateFile(file, this.config.perFileTokenCap!);
        warnings.push(
          `Per-file cap applied: ${file.path} truncated from ${file.tokenCount} to ${this.config.perFileTokenCap} tokens`,
        );
        truncatedFiles.push(file.path);
        return truncated;
      }
      return file;
    });
  }

  /**
   * Apply the configured truncation strategy
   */
  private applyStrategy(files: ContextFile[]): ContextFile[] {
    switch (this.config.truncationStrategy) {
      case "smallest-first":
        return files.sort((a, b) => a.tokenCount - b.tokenCount);

      case "drop-largest":
        return files.sort((a, b) => a.tokenCount - b.tokenCount);

      case "drop-oldest":
        return files.sort(
          (a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime(),
        );

      case "truncate-each":
        // Return in original order for truncate-each
        return files;

      default:
        return files;
    }
  }

  /**
   * Truncate a file to fit within token limit
   */
  private truncateFile(file: ContextFile, maxTokens: number): ContextFile {
    const maxChars = maxTokens * 4; // Reverse the 4:1 approximation
    const truncatedContent = file.content.slice(0, maxChars);

    return {
      ...file,
      content: truncatedContent,
      tokenCount: this.tokenCounter(truncatedContent),
    };
  }

  /**
   * Format context files into a single string for prompt injection
   */
  private formatContext(
    files: ContextFile[],
    warnings: string[],
    limit: number,
  ): string {
    const chunks: string[] = [];

    // Add warning block if truncation occurred
    if (warnings.length > 0) {
      const warningBlock = [
        `\n[System Warning: Context Truncated]`,
        `Token Budget: ${limit}`,
        `Files Affected: ${warnings.length}`,
        `\nDetails:`,
        ...warnings.map((w) => `  - ${w}`),
        `\n`,
      ].join("\n");

      chunks.push(warningBlock);
    }

    // Add each file's content
    for (const file of files) {
      chunks.push(`\n## Context: ${file.path}\n\n${file.content}\n`);
    }

    return chunks.join("\n");
  }

  /**
   * Log context loading operation to IActivity Journal
   */
  private logContextLoad(metadata: {
    totalTokens: number;
    includedCount: number;
    skippedCount: number;
    truncatedCount: number;
    strategy: string;
    isLocalAgent: boolean;
  }): void {
    if (!this.config.db || !this.config.traceId) {
      // If no database or trace ID provided, skip logging (testing/standalone mode)
      return;
    }

    try {
      this.config.db.logActivity(
        "system",
        "context.loaded",
        this.config.requestId || null,
        {
          total_tokens: metadata.totalTokens,
          included_files_count: metadata.includedCount,
          skipped_files_count: metadata.skippedCount,
          truncated_files_count: metadata.truncatedCount,
          strategy: metadata.strategy,
          is_local_agent: metadata.isLocalAgent,
        },
        this.config.traceId,
        this.config.identityId || null,
      );
    } catch (error) {
      // Log to stderr but don't fail context loading
      console.error("[IActivity] Failed to log context.loaded:", error);
    }
  }

  /**
   * Log file load error to IActivity Journal
   */
  private logFileLoadError(
    filePath: string,
    error: unknown,
  ): void {
    if (!this.config.db || !this.config.traceId) {
      // If no database or trace ID, just log to stderr
      console.error(`Failed to load context file ${filePath}:`, error);
      return;
    }

    try {
      this.config.db.logActivity(
        "system",
        "context.file_load_error",
        filePath,
        {
          error_message: error instanceof Error ? error.message : String(error),
          error_type: error instanceof Error ? error.name : "Unknown",
        },
        this.config.traceId,
        this.config.identityId || null,
      );
    } catch (dbError) {
      // Log both errors to stderr
      console.error(`Failed to load context file ${filePath}:`, error);
      console.error("[IActivity] Failed to log file_load_error:", dbError);
    }
  }
}
