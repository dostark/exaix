/**
 * @module ExecutionOutcomes
 * @path packages/execution/src/execution_outcomes.ts
 * @description Settles a finished plan for the execution loop: success and failure reports, execution artifacts, archiving and the terminal journal row.
 * @architectural-layer Services
 * @related-files [packages/execution/src/execution_loop.ts, packages/execution/tests/execution_record_fidelity_test.ts]
 */

import { DEFAULT_EXECUTION_MEMORY_PATH } from "@exaix/shared";
import * as pathBuilders from "@exaix/shared";
import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import type { IDatabaseService } from "@exaix/core/types";
import {
  DomainEventType,
  type IExecutionCompletedVerificationEventPayload,
  type TDomainEventType,
} from "@exaix/core/events";
import type { IGitService } from "@exaix/core/types";
import type { PlanFrontmatter } from "@exaix/schemas/plan_schema.ts";
import { ExecutionStatus } from "@exaix/core";
import { PlanStatus } from "@exaix/core/status";
import { ArtifactRegistry, DatabaseArtifactRepository } from "@exaix/core/artifact";
import { VerificationStatus } from "@exaix/schemas";
import {
  EXECUTION_ARTIFACT_ANALYSIS_SECTION_TITLE,
  EXECUTION_ARTIFACT_PLAN_SECTION_TITLE,
  EXECUTION_ARTIFACT_SECTION_SEPARATOR,
  EXECUTION_REPORT_FILENAME,
} from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { ExecutionReporting } from "./execution_reporting.ts";

// unslop-ignore-next-line unused-type
export interface ISuccessArtifactContext {
  isReadOnly: boolean;
  planAgentId?: string;
  portal?: string;
  targetBranch?: string;
  verificationStatus: VerificationStatus;
  verificationRunId?: string;
  verificationCommitSha?: string | null;
}

/** What the outcome handling of one execution loop needs from it. */
interface IExecutionOutcomesDependencies {
  readonly config: Config;
  readonly db: Opt<IDatabaseService, Reason.OptionalDependency>;
  readonly reporting: ExecutionReporting;
  readonly journal: (action: TDomainEventType, traceId: string, payload: Record<string, JSONValue>) => void;
}

/** Settles a finished plan: reports, learnings, the execution artifacts, archiving and the completion row. */
export class ExecutionOutcomes {
  private readonly config: Config;
  private readonly db: IExecutionOutcomesDependencies["db"];
  private readonly reporting: ExecutionReporting;
  private readonly journal: IExecutionOutcomesDependencies["journal"];

  constructor(dependencies: IExecutionOutcomesDependencies) {
    this.config = dependencies.config;
    this.db = dependencies.db;
    this.reporting = dependencies.reporting;
    this.journal = dependencies.journal;
  }

  /**
   * Handle successful execution
   */
  async handleSuccess(
    planPath: string,
    traceId: string,
    requestId: string,
    frontmatter?: Opt<PlanFrontmatter, Reason.OptionalInput>,
    artifactContext?: Opt<ISuccessArtifactContext, Reason.OptionalContext>,
    completionSummary?: Opt<string, Reason.ExecutionConfig>,
  ): Promise<void> {
    // Generate mission report
    await this.reporting.generateMissionReport(traceId, requestId, frontmatter, completionSummary);

    // Auto-extract learnings from execution if extractor is configured
    await this.reporting.extractExecutionLearnings(traceId);

    // Update plan status to COMPLETED
    try {
      const content = await Deno.readTextFile(planPath);
      const updatedContent = content.replace(
        /status: "?(active|approved)"?/,
        `status: ${PlanStatus.COMPLETED}`,
      );
      await Deno.writeTextFile(planPath, updatedContent);
    } catch (error) {
      console.error("Failed to update plan status:", error);
    }

    // Persist the executed plan as an execution artifact for trace inspection.
    // This avoids relying on git diffs for read-only agent outputs.
    try {
      const execDir = pathBuilders.memoryExecutionPath(
        join(this.config.system.root, this.config.paths.memory),
        traceId,
      );
      await Deno.mkdir(execDir, { recursive: true });

      const planContent = await Deno.readTextFile(planPath);
      await Deno.writeTextFile(join(execDir, "plan.md"), planContent);
    } catch (error) {
      console.error("Failed to persist plan artifact:", error);
    }

    // Create a canonical review artifact for read-only agent executions.
    // This provides a single stable review surface (separate from git).
    const artifactRepo = this.db ? new DatabaseArtifactRepository(this.db) : undefined;
    if (artifactContext?.isReadOnly && artifactRepo && artifactContext.planAgentId) {
      try {
        const execDir = pathBuilders.memoryExecutionPath(
          join(this.config.system.root, this.config.paths.memory),
          traceId,
        );
        const summaryPath = pathBuilders.memoryExecutionPath(
          join(this.config.system.root, this.config.paths.memory),
          traceId,
          "summary.md",
        );
        const summaryContent = await Deno.readTextFile(summaryPath);
        let planContent = "";
        let analysisContent = "";

        try {
          planContent = await Deno.readTextFile(join(execDir, "plan.md"));
        } catch (error) {
          console.error("Failed to read plan content for artifact:", error);
        }

        try {
          analysisContent = await Deno.readTextFile(join(execDir, EXECUTION_REPORT_FILENAME));
        } catch (error) {
          console.error("Failed to read analysis content for artifact:", error);
        }

        const memoryRoot = this.config.paths.memory.replace(/^\.\/?/, "");
        const memoryExecutionDir = this.config.paths.memoryExecution || DEFAULT_EXECUTION_MEMORY_PATH;
        const traceDirRel = `${memoryRoot}/${memoryExecutionDir}/${traceId}/`;
        const planSection = planContent.trim().length > 0
          ? `${EXECUTION_ARTIFACT_SECTION_SEPARATOR}${EXECUTION_ARTIFACT_PLAN_SECTION_TITLE}` +
            `${EXECUTION_ARTIFACT_SECTION_SEPARATOR}${planContent}`
          : "";
        const analysisSection = analysisContent.trim().length > 0
          ? `${EXECUTION_ARTIFACT_SECTION_SEPARATOR}${EXECUTION_ARTIFACT_ANALYSIS_SECTION_TITLE}` +
            `${EXECUTION_ARTIFACT_SECTION_SEPARATOR}${analysisContent}`
          : "";
        const artifactBody = `# Execution Artifact\n\n` +
          `**Request:** ${requestId}\n\n` +
          `**Trace:** ${traceId}\n\n` +
          `**Trace directory:** ${traceDirRel}` +
          `${EXECUTION_ARTIFACT_SECTION_SEPARATOR}${summaryContent}${planSection}${analysisSection}`;

        const artifactRegistry = new ArtifactRegistry(artifactRepo, this.config.system.root);
        await artifactRegistry.createArtifact(
          requestId,
          artifactContext.planAgentId,
          artifactBody,
          artifactContext.portal,
          artifactContext.targetBranch,
        );
      } catch (error) {
        console.error("Failed to create read-only artifact:", error);
      }
    }

    // Move plan to Workspace/Archive
    const archiveDir = join(
      this.config.system.root,
      this.config.paths.workspace,
      this.config.paths.archive,
    );
    await Deno.mkdir(archiveDir, { recursive: true });

    const planFileName = planPath.split("/").pop()!;
    const archivePath = join(archiveDir, planFileName);

    await Deno.rename(planPath, archivePath);

    // Also move the original request to Workspace/Archive to keep the inbox clean
    await this.reporting.archiveRequest(requestId, ExecutionStatus.COMPLETED, archiveDir);

    // Log completion
    this.journal(
      DomainEventType.ExecutionCompleted,
      traceId,
      {
        request_id: requestId,
        archived_to: archivePath,
        verification_status: artifactContext?.verificationStatus ?? VerificationStatus.NOT_CONFIGURED,
        commit_sha: artifactContext?.verificationCommitSha ?? null,
        ...(artifactContext?.verificationRunId === undefined
          ? {}
          : { verification_run_id: artifactContext.verificationRunId }),
      } satisfies IExecutionCompletedVerificationEventPayload & { archived_to: string },
    );
  }

  /**
   * Handle execution failure
   */
  async handleFailure(
    planPath: string,
    traceId: string,
    requestId: string,
    error: string,
    frontmatter?: Opt<PlanFrontmatter, Reason.OptionalInput>,
    _cleanup?: Opt<{
      portalGitService?: IGitService;
      worktreePath?: string;
    }, Reason.OptionalInput>,
  ): Promise<void> {
    // Generate failure report
    await this.reporting.generateFailureReport(traceId, requestId, error, frontmatter);

    // Auto-extract troubleshooting learnings from failed execution
    await this.reporting.extractExecutionLearnings(traceId);

    // Persist the failed plan as an execution artifact for trace inspection.
    let planContent: string | null = null;
    try {
      const execDir = pathBuilders.memoryExecutionPath(
        join(this.config.system.root, this.config.paths.memory),
        traceId,
      );
      await Deno.mkdir(execDir, { recursive: true });
      planContent = await Deno.readTextFile(planPath);
      await Deno.writeTextFile(join(execDir, "plan.md"), planContent);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) {
        console.error("Failed to persist plan artifact on failure:", e);
      } else {
        console.warn("Plan file missing during failure persistence:", planPath);
      }
    }

    // Move plan to Workspace/Rejected
    const rejectedDir = pathBuilders.rejectedPath(join(this.config.system.root, this.config.paths.workspace));
    await Deno.mkdir(rejectedDir, { recursive: true });

    const planFileName = planPath.split("/").pop()!;
    const rejectedPlanName = planFileName.replace(".md", "_failed.md");
    const targetRejectedPath = join(rejectedDir, rejectedPlanName);

    if (planContent !== null) {
      let updatedContent = planContent.replace(
        /status: "?(active|approved|review)"?/,
        `status: ${PlanStatus.ERROR}`,
      );

      // Append error to frontmatter if possible
      if (!updatedContent.includes("error:")) {
        const displayError = (error || "Unknown error").replace(/"/g, '\\"');
        updatedContent = updatedContent.replace(/---\n/, `---\nerror: "${displayError}"\n`);
      }

      await Deno.writeTextFile(targetRejectedPath, updatedContent);
    } else {
      const displayError = (error || "Unknown error").replace(/"/g, '\\"');
      const fallbackContent = `---\nstatus: ${PlanStatus.ERROR}\nerror: "${displayError}"\n---\n`;
      await Deno.writeTextFile(targetRejectedPath, fallbackContent);
      console.warn(
        "Wrote fallback rejected plan content because the original plan file was missing:",
        targetRejectedPath,
      );
    }

    // Move the original request to Workspace/Rejected along with the plan
    // This keeps Workspace/Requests as an active 'Inbox' for new/planned work.
    await this.reporting.archiveRequest(requestId, ExecutionStatus.FAILED, rejectedDir);

    // Remove the plan from Active
    try {
      await Deno.remove(planPath);
    } catch (removeError) {
      console.warn(`Failed to remove failed plan from active: ${planPath}`, removeError);
    }

    // Rollback git changes are now handled by GitService guards and worktree isolation.
    // We no longer perform global 'git reset --hard' in the system root.
    if (_cleanup?.worktreePath && _cleanup?.portalGitService) {
      try {
        await _cleanup.portalGitService.removeWorktree(_cleanup.worktreePath, {
          force: true,
          deleteBranch: true,
        });
      } catch (error) {
        console.warn(`Failed to cleanup worktree at ${_cleanup.worktreePath}:`, error);
      }
    }

    // Log failure
    this.journal(DomainEventType.ExecutionFailed, traceId, {
      request_id: requestId,
      error,
      moved_to: targetRejectedPath,
    });
  }
}
