/**
 * @module ExecutionReporting
 * @path packages/execution/src/execution_reporting.ts
 * @description Reporting of the execution loop: mission and failure reports, execution learnings, review registration and request archiving.
 * @architectural-layer Services
 * @related-files [packages/execution/src/execution_loop.ts, packages/execution/tests/execution_loop_memory_extraction_test.ts]
 */

import * as pathBuilders from "@exaix/shared";
import { join } from "@std/path";
import { exists } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import type { IApplicationContext } from "@exaix/core/types";
import type { IDatabaseService } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType, type IEventJournalReader, type TDomainEventType } from "@exaix/core/events";
import type { IMemoryBankService } from "@exaix/core/types";
import type { PlanFrontmatter } from "@exaix/schemas/plan_schema.ts";
import type { ReviewRegistry } from "@exaix/core/artifact";
import type { MemoryBankService } from "@exaix/memory";
import type { ITraceData } from "@exaix/core/artifact";
import { MissionReporter } from "@exaix/core/artifact";
import { ExecutionStatus } from "@exaix/core";
import { EXECUTION_REPORT_FILENAME } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

// unslop-ignore-next-line unused-type
/** Options for registerReview. */
export interface IRegisterReviewOptions {
  requestId: string;
  traceId: string;
  portal: string;
  branch: string;
  commitSha: string;
  repository: string;
  baseBranch: string;
  worktreePath?: string;
}

/** What the reporting of one execution loop needs from it. */
interface IExecutionReportingDependencies {
  readonly config: Config;
  readonly db: Opt<IDatabaseService, Reason.OptionalDependency>;
  readonly logger: Opt<IEventLogger, Reason.OptionalDependency>;
  readonly memoryBank: Opt<IMemoryBankService, Reason.OptionalDependency>;
  readonly reviewRegistry: Opt<ReviewRegistry, Reason.OptionalDependency>;
  readonly extractor: Opt<IApplicationContext["extractor"], Reason.OptionalDependency>;
  readonly agentRole: string;
  readonly journal: (action: TDomainEventType, traceId: string, payload: Record<string, JSONValue>) => void;
}

/** Mission and failure reports, execution learnings, review registration and request archiving for one execution loop. */
export class ExecutionReporting {
  private readonly config: Config;
  private readonly db: IExecutionReportingDependencies["db"];
  private readonly logger: IExecutionReportingDependencies["logger"];
  private readonly memoryBank: IExecutionReportingDependencies["memoryBank"];
  private readonly reviewRegistry: IExecutionReportingDependencies["reviewRegistry"];
  private readonly extractor: IExecutionReportingDependencies["extractor"];
  private readonly agentRole: string;
  private readonly journal: IExecutionReportingDependencies["journal"];

  constructor(dependencies: IExecutionReportingDependencies) {
    this.config = dependencies.config;
    this.db = dependencies.db;
    this.logger = dependencies.logger;
    this.memoryBank = dependencies.memoryBank;
    this.reviewRegistry = dependencies.reviewRegistry;
    this.extractor = dependencies.extractor;
    this.agentRole = dependencies.agentRole;
    this.journal = dependencies.journal;
  }

  /**
   * Create a MissionReporter instance with Memory Bank integration
   */
  private createMissionReporter(): MissionReporter {
    if (!this.memoryBank) {
      throw new Error(
        "ExecutionLoop: memoryBank is required for mission reports. Provide `memoryBank` in IExecutionLoopConfig or via context.memoryBank.",
      );
    }
    const reader = this.db
      ? {
        getActivitiesByTrace: (id: string) => this.db!.getActivitiesByTrace(id),
        getActivitiesByTraceSafe: (id: string) => this.db!.getActivitiesByTraceSafe(id),
        getRecentActivity: (limit?: Opt<number, Reason.OptionalInput>) => this.db!.getRecentActivity(limit),
        queryActivity: (filter) => this.db!.queryActivity(filter),
      } as IEventJournalReader
      : undefined;
    return new MissionReporter(this.config, this.memoryBank as MemoryBankService, this.logger, reader);
  }

  /** Extracts learnings from execution with the configured MemoryExtractorService.
   *  It loads the persisted execution record and runs analyzeExecution and createProposal. */
  /** Extracts learnings from the persisted execution record into Pending proposals. Public so the loop boundary can test it.
   *  It writes proposals only. The approval pipeline alone feeds the global bank, embedding index and tiered memory. */
  async extractExecutionLearnings(traceId: string): Promise<void> {
    if (!this.extractor) return;

    try {
      if (!this.memoryBank) return;
      const executionMemory = await this.memoryBank.getExecutionByTraceId(traceId);
      if (!executionMemory) return;

      const learnings = await this.extractor.analyzeExecution(executionMemory);
      for (const learning of learnings) {
        // Proposals only: the tiered-memory feed waits for approval.
        // The extractor options' onApproved hook is the one seam that feeds session memory.
        await this.extractor.createProposal(learning, executionMemory, this.agentRole);
      }
    } catch (error) {
      console.error("[ExecutionLoop] Failed to extract memory learnings:", error);
    }
  }

  /**
   * Register a new review after successful execution
   */
  async registerReview(
    opts: IRegisterReviewOptions,
  ): Promise<void> {
    const { requestId, traceId, portal, branch, commitSha, repository, baseBranch, worktreePath } = opts;
    try {
      console.log(`[ExecutionLoop] Registering review for ${requestId} (Branch: ${branch})`);
      if (this.reviewRegistry) {
        await this.reviewRegistry.register({
          trace_id: traceId,
          portal: portal,
          branch: branch,
          repository,
          base_branch: baseBranch,
          worktree_path: worktreePath,
          description: `Execution for request ${requestId}`,
          commit_sha: commitSha,
          files_changed: 1, // Defaulting to 1 for now
          created_by: this.agentRole,
        });
        console.log(`[ExecutionLoop] Review registered successfully`);
      } else {
        console.error("[ExecutionLoop] reviewRegistry is NOT initialized!");
      }
    } catch (error) {
      console.error("[ExecutionLoop] Failed to register review:", error);
    }
  }

  private traceDataFor(
    traceId: string,
    requestId: string,
    frontmatter: Opt<PlanFrontmatter, Reason.OptionalInput>,
    status: ExecutionStatus,
    reasoning: string,
    summary: string,
  ): ITraceData {
    return {
      traceId,
      requestId,
      agentRole: this.agentRole,
      status,
      branch: `feat/${requestId}-${traceId.substring(0, 8)}`,
      completedAt: new Date(),
      contextFiles: frontmatter?.portal ? [frontmatter.portal] : [],
      reasoning,
      summary,
    };
  }

  /**
   * Generate mission report for successful execution using Memory Banks
   */
  async generateMissionReport(
    traceId: string,
    requestId: string,
    frontmatter?: Opt<PlanFrontmatter, Reason.OptionalInput>,
    completionSummary?: Opt<string, Reason.ExecutionConfig>,
  ): Promise<void> {
    try {
      const reporter = this.createMissionReporter();

      const traceData = this.traceDataFor(
        traceId,
        requestId,
        frontmatter,
        ExecutionStatus.COMPLETED,
        completionSummary ?? "Plan execution completed successfully",
        completionSummary ?? `Successfully executed plan for request: ${requestId}`,
      );

      await reporter.generate(traceData);

      this.journal(DomainEventType.ReportGenerated, traceId, {
        request_id: requestId,
        report_type: "mission",
        reporter: "memory_banks",
      });
    } catch (error) {
      this.journal(DomainEventType.ReportError, traceId, {
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Generate failure report using Memory Banks
   */
  async generateFailureReport(
    traceId: string,
    requestId: string,
    error: string,
    frontmatter?: Opt<PlanFrontmatter, Reason.OptionalInput>,
  ): Promise<void> {
    try {
      const reporter = this.createMissionReporter();

      const traceData = this.traceDataFor(
        traceId,
        requestId,
        frontmatter,
        ExecutionStatus.FAILED,
        `Plan execution failed: ${error}`,
        `Execution failed for request: ${requestId}`,
      );

      await reporter.generate(traceData);

      // Also write a human-readable failure.md file for easy access (tests expect this file)
      try {
        const failureDir = pathBuilders.memoryExecutionPath(
          join(this.config.system.root, this.config.paths.memory),
          traceId,
        );
        await Deno.mkdir(failureDir, { recursive: true });
        const failureContent =
          `# Failure Report\n\n**Trace ID:** ${traceId}\n**Request ID:** ${requestId}\n**Agent:** ${this.agentRole}\n**Error:** ${error}\n\n**Summary:** ${traceData.summary}\n**Reasoning:** ${traceData.reasoning}\n\nGenerated at ${
            new Date().toISOString()
          }`;
        await Deno.writeTextFile(join(failureDir, "failure.md"), failureContent);
      } catch (_e) {
        // Non-fatal - logging already handled below
      }

      this.journal(DomainEventType.ReportGenerated, traceId, {
        request_id: requestId,
        report_type: "failure",
        reporter: "memory_banks",
        error,
      });
    } catch (reportError) {
      this.journal(DomainEventType.ReportError, traceId, {
        request_id: requestId,
        error: reportError instanceof Error ? reportError.message : String(reportError),
      });
    }
  }

  /**
   * Update request status and archive the file to keep the Workspace/Requests inbox clean.
   */
  async archiveRequest(
    requestId: string,
    status: ExecutionStatus | string,
    targetDir: string,
  ): Promise<void> {
    const requestsDir = join(
      this.config.system.root,
      this.config.paths.workspace,
      this.config.paths.requests,
    );
    const requestPath = join(requestsDir, `${requestId}.md`);

    if (!(await exists(requestPath))) return;

    try {
      // 1. Update status in file
      const content = await Deno.readTextFile(requestPath);
      const updatedContent = content.replace(
        /status: "?\w+"?/,
        `status: ${status}`,
      );
      await Deno.writeTextFile(requestPath, updatedContent);

      // 2. Archive file
      await Deno.mkdir(targetDir, { recursive: true });
      const targetPath = join(targetDir, `${requestId}.md`);

      // Use rename to move it
      await Deno.rename(requestPath, targetPath);
    } catch (error) {
      console.warn(`Failed to archive request ${requestId} to ${targetDir}:`, error);
    }
  }

  async persistExecutionReport(traceId: string, report: string): Promise<void> {
    try {
      const execDir = pathBuilders.memoryExecutionPath(
        join(this.config.system.root, this.config.paths.memory),
        traceId,
      );
      await Deno.mkdir(execDir, { recursive: true });
      await Deno.writeTextFile(join(execDir, EXECUTION_REPORT_FILENAME), report);
    } catch (error) {
      console.error("Failed to persist execution report:", error);
    }
  }
}
