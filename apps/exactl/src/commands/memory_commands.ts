/**
 * @module MemoryCommands
 * @path apps/exactl/src/commands/memory_commands.ts
 * @description Provides CLI commands for interacting with Memory Banks, including list, search, project, execution, and proposal management.
 * @architectural-layer CLI
 * @related-files ["packages/memory/src/bank/memory_bank.ts", "apps/daemon/main.ts"]
 */

import * as pathBuilders from "@exaix/shared";
import { MemoryType } from "@exaix/core";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { UIOutputFormat } from "@exaix/tui";
import type { Opt, Reason } from "@exaix/core/types";
import type { IExecutionMemory, IMemorySearchResult, IProjectMemory } from "@exaix/schemas/memory_bank.ts";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { MEMORY_COMMAND_DEFAULTS } from "@exaix/cli/config.ts";
import { MemoryFormatter } from "@exaix/cli/formatters/memory_formatter.ts";
import type { IMemoryBankSummary, OutputFormat } from "@exaix/cli/types/memory_types.ts";
import type { IIndexRebuildResult, IProjectListRow } from "./memory_results.ts";

function notFound(message: string): ExaCtlError {
  return new ExaCtlError(ExaCtlExitCode.NOT_FOUND, message);
}

export class MemoryCommands extends BaseCommand {
  private formatter: MemoryFormatter;

  constructor(context: ICommandContext) {
    super(context);
    this.formatter = new MemoryFormatter();
  }

  private formatOutput<T>(format: OutputFormat, data: T, mdFn: (d: T) => string, tableFn: (d: T) => string): string {
    switch (format) {
      case UIOutputFormat.JSON:
        return JSON.stringify(data, null, 2);
      case UIOutputFormat.MARKDOWN:
        return mdFn(data);
      case UIOutputFormat.TABLE:
      default:
        return tableFn(data);
    }
  }

  /**
   * Get memory banks summary
   */
  async getSummary(): Promise<IMemoryBankSummary> {
    const projects: string[] = [];
    let executions = 0;
    let lastActivity: string | null = null;

    // List projects
    const projectsDir = pathBuilders.memoryProjectsPath(join(this.config.system.root, this.config.paths.memory));
    if (await exists(projectsDir)) {
      for await (const entry of Deno.readDir(projectsDir)) {
        if (entry.isDirectory) {
          projects.push(entry.name);
        }
      }
    }

    // Count executions and find last activity
    const executionDir = pathBuilders.memoryExecutionPath(join(this.config.system.root, this.config.paths.memory));
    if (await exists(executionDir)) {
      const executionList = await this.memoryBank.getExecutionHistory(undefined, 1);
      executions = await this.countExecutions();
      if (executionList.length > 0) {
        lastActivity = executionList[0].started_at;
      }
    }

    return {
      projects: projects.sort(),
      executions,
      lastActivity,
    };
  }

  /**
   * Count total executions
   */
  private async countExecutions(): Promise<number> {
    let count = 0;
    const executionDir = pathBuilders.memoryExecutionPath(join(this.config.system.root, this.config.paths.memory));
    if (await exists(executionDir)) {
      for await (const entry of Deno.readDir(executionDir)) {
        if (entry.isDirectory) {
          count++;
        }
      }
    }
    return count;
  }

  // Memory Search Command

  async search(
    query: string,
    options?: Opt<{
      portal?: string;
      tags?: string[];
      limit?: number;
      useEmbeddings?: boolean;
    }, Reason.QueryFilter>,
  ): Promise<IMemorySearchResult[]> {
    const limit = options?.limit || MEMORY_COMMAND_DEFAULTS.LIMIT;

    // Use advanced search if tags are specified
    if (options?.tags && options.tags.length > 0) {
      return await this.memoryBank.searchMemoryAdvanced({
        tags: options.tags,
        keyword: query,
        portal: options.portal,
        limit,
      });
    }
    if (options?.useEmbeddings) {
      const embeddingResults = await this.embedding.searchByEmbedding(query, {
        limit,
      });
      return embeddingResults.map((r) => ({
        type: MemoryType.LEARNING,
        title: r.title,
        summary: r.summary,
        relevance_score: r.similarity,
        id: r.id,
      }));
    }
    return await this.memoryBank.searchMemory(query, {
      portal: options?.portal,
      limit,
    });
  }

  // Project Commands

  async projectList(): Promise<IProjectListRow[]> {
    const projects: IProjectListRow[] = [];

    const projectsDir = pathBuilders.memoryProjectsPath(join(this.config.system.root, this.config.paths.memory));
    if (await exists(projectsDir)) {
      for await (const entry of Deno.readDir(projectsDir)) {
        if (entry.isDirectory) {
          const projectMem = await this.memoryBank.getProjectMemory(entry.name);
          if (projectMem) {
            projects.push({
              name: entry.name,
              patterns: projectMem.patterns.length,
              decisions: projectMem.decisions.length,
            });
          }
        }
      }
    }

    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }

  async projectShow(portal: string): Promise<IProjectMemory> {
    const projectMem = await this.memoryBank.getProjectMemory(portal);

    if (!projectMem) {
      throw notFound(`Project memory not found for portal "${portal}"`);
    }

    return projectMem;
  }

  // Execution Commands

  async executionList(
    options?: Opt<{
      portal?: string;
      limit?: number;
    }, Reason.OptionalInput>,
  ): Promise<IExecutionMemory[]> {
    return await this.memoryBank.getExecutionHistory(
      options?.portal,
      options?.limit || MEMORY_COMMAND_DEFAULTS.LIMIT,
    );
  }

  async executionShow(traceId: string): Promise<IExecutionMemory> {
    const execution = await this.memoryBank.getExecutionByTraceId(traceId);

    if (!execution) {
      throw notFound(`Execution not found for trace ID "${traceId}"`);
    }

    return execution;
  }

  // Global Memory Commands

  async globalShow(format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    const globalMem = await this.memoryBank.getGlobalMemory();

    if (!globalMem) {
      return "Global memory not initialized. Run 'exactl memory global init' first.";
    }

    return this.formatOutput(
      format,
      globalMem,
      (d) => this.formatter.formatGlobalShowMarkdown(d),
      (d) => this.formatter.formatGlobalShowTable(d),
    );
  }

  async globalListLearnings(format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    const globalMem = await this.memoryBank.getGlobalMemory();

    if (!globalMem) {
      return "Global memory not initialized.";
    }

    const learnings = globalMem.learnings;

    if (learnings.length === 0) {
      return "No learnings in global memory.";
    }

    switch (format) {
      case UIOutputFormat.JSON:
        return JSON.stringify(learnings, null, 2);
      case UIOutputFormat.MARKDOWN:
        return this.formatter.formatGlobalLearningsMarkdown(learnings);
      case UIOutputFormat.TABLE:
      default:
        return this.formatter.formatGlobalLearningsTable(learnings);
    }
  }

  async globalStats(format: OutputFormat = UIOutputFormat.TABLE): Promise<string> {
    const globalMem = await this.memoryBank.getGlobalMemory();

    if (!globalMem) {
      return "Global memory not initialized. Run 'exactl memory global init' first.";
    }

    return this.formatOutput(
      format,
      globalMem.statistics,
      (d) => this.formatter.formatGlobalStatsMarkdown(d),
      (d) => this.formatter.formatGlobalStatsTable(d),
    );
  }

  // Rebuild Index Command

  async rebuildIndex(
    options?: Opt<{ includeEmbeddings?: boolean }, Reason.OptionalInput>,
  ): Promise<IIndexRebuildResult> {
    if (options?.includeEmbeddings) {
      await this.memoryBank.rebuildIndicesWithEmbeddings(this.embedding);
      const stats = await this.embedding.getStats();
      return { embeddings: stats.total };
    }
    await this.memoryBank.rebuildIndices();
    return { embeddings: null };
  }
}
