/**
 * @module PlanExecutor
 * @path packages/core/src/planning/plan_executor.ts
 * @description Orchestrates the Step-by-Step execution of approved plans.
 * Managing the ReAct loop: prompting LLM for actions, executing tools, and committing results.
 * @architectural-layer Services
 * @related-files ["packages/tool-runtime/src/tool_registry.ts", "packages/execution/src/execution_loop.ts"]
 */

import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { DatabaseService } from "@exaix/storage-sqlite";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import { SafeSubprocess } from "@exaix/core";
import { AgentExecutor } from "@exaix/execution";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import type { ConfidenceScorer } from "@exaix/execution";
import { DEFAULT_AMENDMENT_THRESHOLD, ExecutionStatus, SecurityMode } from "@exaix/core";
import {
  ACTIVITY_ACTOR_AGENT,
  AMENDMENT_ARTIFACTS_DIR,
  PLAN_AMENDMENT_EVENT_AWAITING_APPROVAL,
  PLAN_AMENDMENT_EVENT_PROPOSED,
  PORTAL_ALIAS_WORKSPACE,
  PROMPT_PLAN_STEP_REASONING_PREFIX,
  PROMPT_PLAN_STEP_TASK_PREFIX,
  REPORT_GENERATION_MAX_TOKENS,
  REPORT_GENERATION_TEMPERATURE,
} from "@exaix/core";
import {
  DEFAULT_GIT_REV_PARSE_TIMEOUT_MS,
  GIT_CMD_REV_PARSE,
  GIT_ERROR_NOTHING_TO_COMMIT,
  GitService,
} from "@exaix/git";
import type { JSONValue } from "@exaix/core";
import type { IApplicationContext, IPlanAmendmentService } from "@exaix/core/types";
import type { IDatabaseService } from "@exaix/core/types";
import { PlanAmendmentService } from "./plan_amendment_service.ts";
import type { IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";
import { PlanAmendmentPendingError } from "./errors.ts";

export interface IPlanStep {
  number: number;
  title: string;
  content: string;
}

export interface IPlanContext {
  trace_id: string;
  request_id: string;
  identity: string;
  frontmatter: Record<string, JSONValue>;
  steps: IPlanStep[];
}

export interface IPlanExecutionResult {
  lastCommitSha: string | null;
  report?: string;
}

export interface IPlanExecutorOptions {
  enableGit?: boolean;
  generateReport?: boolean;
  context?: IApplicationContext;
  confidenceScorer?: ConfidenceScorer;
  amendmentService?: IPlanAmendmentService;
}

export interface IPlanActionReport {
  stepNumber: number;
  stepTitle: string;
  tool: string;
  params: Record<string, JSONValue>;
  success: boolean;
  output?: string;
  error?: string;
}

export interface IPlanAction {
  tool: string;
  params: Record<string, JSONValue>;
  description?: string;
}

function noopLogger(): IEventLogger {
  return {
    info: () => Promise.resolve(),
    warn: () => Promise.resolve(),
    log: () => Promise.resolve(),
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    child: () => noopLogger(),
  };
}

export class PlanExecutor {
  private logger: IEventLogger;
  private enableGit: boolean;
  private generateReport: boolean;
  private config: Config;
  private db: IDatabaseService;

  constructor(
    config: Config,
    private llmProvider: IModelProvider,
    db: IDatabaseService,
    private repoPath: string,
    logger?: IEventLogger,
    private options: IPlanExecutorOptions = {},
  ) {
    const ctx = options.context;
    this.config = ctx?.config.get() || config;
    this.db = ctx?.db || db;
    this.logger = logger ?? noopLogger();
    this.enableGit = options.enableGit ?? true;
    this.generateReport = options.generateReport ?? false;
  }

  /**
   * Execute a plan
   */
  async execute(planPath: string, context: IPlanContext): Promise<IPlanExecutionResult> {
    const traceId = context.trace_id;
    const requestId = context.request_id;
    const actionReports: IPlanActionReport[] = [];

    await this.logger.info(DomainEventType.PlanExecutionStarted, planPath, {
      trace_id: traceId,
      request_id: requestId,
      step_count: context.steps.length,
    });

    try {
      const git = this.enableGit
        ? new GitService({
          config: this.config,
          repoPath: this.repoPath,
          traceId,
          identityId: context.identity,
        })
        : null;

      if (git) {
        await git.ensureRepository();
        await git.ensureIdentity();
        await git.createBranch({ requestId, traceId });
      }

      const initialHeadSha = git ? await this.getPortalHeadSha(this.repoPath) : null;
      const portalName = this.resolvePortalName(context.frontmatter.portal);
      const agentExecutor = this.createAgentExecutor(traceId);

      try {
        const lastCommitSha = await this.executeSteps(
          context,
          portalName,
          git,
          agentExecutor,
          actionReports,
        );

        if (git) {
          await this.commitPlanCompletion(git, requestId, traceId, context.identity);
        }

        await this.logger.info(DomainEventType.PlanExecutionCompleted, planPath, {
          trace_id: traceId,
          status: ExecutionStatus.COMPLETED,
          last_commit: lastCommitSha === initialHeadSha ? null : lastCommitSha,
        });

        const report = (this.generateReport || context.steps.length === 0)
          ? await this.generateExecutionReport(context, actionReports)
          : undefined;

        const effectiveSha = (git && lastCommitSha !== initialHeadSha) ? lastCommitSha : null;

        return {
          lastCommitSha: effectiveSha,
          report,
        };
      } finally {
        agentExecutor.dispose();
      }
    } catch (error) {
      await this.logger.error(DomainEventType.PlanExecutionFailed, planPath, {
        error: error instanceof Error ? error.message : String(error),
        trace_id: traceId,
      });
      throw error;
    }
  }

  /**
   * Resolve portal name from frontmatter or default to workspace.
   */
  private resolvePortalName(frontmatterPortal: JSONValue | undefined): string {
    const portalName = frontmatterPortal as string | undefined;
    if (portalName) {
      const portal = this.config.portals.find((p) => p.alias === portalName);
      if (portal) {
        return portalName;
      }
    }
    return PORTAL_ALIAS_WORKSPACE;
  }

  /**
   * Create an AgentExecutor instance with proper dependencies.
   */
  private createAgentExecutor(traceId: string): AgentExecutor {
    const pathResolver = new PathResolver(this.config, {
      traceId,
    });
    const permissions = new PortalPermissionsService(this.config.portals);

    return new AgentExecutor(
      this.config,
      this.db as DatabaseService,
      this.logger,
      pathResolver,
      permissions,
      this.llmProvider,
    );
  }

  /**
   * Execute all plan steps sequentially, collecting action reports.
   * Returns the last successful commit SHA.
   */
  private async executeSteps(
    context: IPlanContext,
    portalName: string,
    git: GitService | null,
    agentExecutor: AgentExecutor,
    actionReports: IPlanActionReport[],
  ): Promise<string | null> {
    const traceId = context.trace_id;
    const requestId = context.request_id;
    let lastCommitSha: string | null = null;

    for (const step of context.steps) {
      try {
        const result = await agentExecutor.executeStep(
          {
            trace_id: traceId,
            request_id: requestId,
            request: step.content,
            plan: `${PROMPT_PLAN_STEP_TASK_PREFIX}${step.title}${PROMPT_PLAN_STEP_REASONING_PREFIX}${step.content}`,
            portal: portalName,
          },
          {
            identity_id: context.identity,
            portal: portalName,
            security_mode: SecurityMode.HYBRID,
            audit_enabled: true,
          },
        );

        // Step 66.2: Low Confidence Trigger Detection
        if (this.options.confidenceScorer && this.config.amendment?.enabled) {
          const assessment = this.options.confidenceScorer.assessQuick(result.description);
          const threshold = this.config.amendment.threshold ?? DEFAULT_AMENDMENT_THRESHOLD;

          if (assessment.score < threshold) {
            await this.handleAmendmentTrigger(
              {
                source: "low_confidence",
                stepId: String(step.number),
                reason: assessment.reasoning || "Low confidence score",
                confidenceScore: assessment.score,
              },
              context,
              step,
            );
          }
        }

        if (git) {
          await this.commitStepChanges(git, step, result, traceId, requestId);
          lastCommitSha = await this.getPortalHeadSha(this.repoPath);
        }

        actionReports.push({
          stepNumber: step.number,
          stepTitle: step.title,
          tool: ACTIVITY_ACTOR_AGENT,
          params: { request: step.content },
          success: true,
          output: result.description,
        });
      } catch (error) {
        // Step 66.2: Tool Error Trigger Detection
        if (this.config.amendment?.enabled && !(error instanceof PlanAmendmentPendingError)) {
          await this.handleAmendmentTrigger(
            {
              source: "tool_error",
              stepId: String(step.number),
              reason: error instanceof Error ? error.message : String(error),
            },
            context,
            step,
          );
        }
        throw error;
      }
    }

    return lastCommitSha;
  }

  /**
   * Commit step changes to git, ignoring 'nothing to commit' errors.
   */
  private async commitStepChanges(
    git: GitService,
    step: IPlanStep,
    result: { description: string },
    traceId: string,
    requestId: string,
  ): Promise<void> {
    try {
      await git.commit({
        message: `Step ${step.number}: ${step.title}`,
        description: `Trace: ${traceId}\nRequest: ${requestId}\n\n${result.description}`,
        traceId,
      });
    } catch (error) {
      if (!(error instanceof Error && error.message.includes(GIT_ERROR_NOTHING_TO_COMMIT))) {
        throw error;
      }
    }
  }

  /**
   * Create a final commit indicating plan completion.
   */
  private async commitPlanCompletion(
    git: GitService,
    requestId: string,
    traceId: string,
    identityId: string,
  ): Promise<void> {
    try {
      await git.commit({
        message: `Complete plan: ${requestId}`,
        description: `Executed by identity ${identityId}`,
        traceId,
      });
    } catch (error) {
      if (!(error instanceof Error && error.message.includes(GIT_ERROR_NOTHING_TO_COMMIT))) {
        throw error;
      }
    }
  }

  private async generateExecutionReport(
    _context: IPlanContext,
    actionReports: IPlanActionReport[],
  ): Promise<string> {
    const reportSummary = actionReports.map((entry) => {
      return `### Step ${entry.stepNumber}: ${entry.stepTitle}\n${entry.output}`;
    }).join("\n\n");

    const prompt =
      `### EXECUTION REPORT SUMMARY ###\n\nGenerate a concise Markdown report for the following plan execution:\n\n${reportSummary}`;

    const result = await this.llmProvider.generate(prompt, {
      temperature: REPORT_GENERATION_TEMPERATURE,
      max_tokens: REPORT_GENERATION_MAX_TOKENS,
    });
    return result.content;
  }

  /**
   * Handle an amendment trigger by evaluating policy and proposing changes.
   */
  private async handleAmendmentTrigger(
    trigger: IPlanAmendmentTrigger,
    context: IPlanContext,
    _currentStep: IPlanStep,
  ): Promise<void> {
    const service = this.options.amendmentService || new PlanAmendmentService(this.config, this.llmProvider);

    if (await service.shouldAmend(trigger)) {
      await this.logger.info(DomainEventType.PlanAmendmentTriggered, context.trace_id, {
        source: trigger.source,
        reason: trigger.reason,
        stepId: trigger.stepId,
      });

      // 1. Compute remaining steps
      const remainingSteps = context.steps.filter((s) => s.number > _currentStep.number);

      // 2. Propose amendment
      const patch = await service.proposeAmendment({
        planId: context.request_id, // request_id is used as planId in some contexts
        remainingSteps,
        trigger,
      });

      // 3. Emit PROPOSED event before approval gate
      await this.logger.info(PLAN_AMENDMENT_EVENT_PROPOSED, context.trace_id, {
        amendmentId: patch.amendmentId,
        planId: patch.planId,
        stepId: trigger.stepId,
        triggerSource: trigger.source,
      });

      // 4. Persist amendment artifact
      const executionRoot = this.config.paths.memoryExecution.includes("/")
        ? this.config.paths.memoryExecution
        : join(this.config.paths.memory, this.config.paths.memoryExecution);

      const amendmentsDir = join(
        this.config.system.root,
        executionRoot,
        context.trace_id,
        AMENDMENT_ARTIFACTS_DIR,
      );
      await Deno.mkdir(amendmentsDir, { recursive: true });
      await Deno.writeTextFile(
        join(amendmentsDir, `${patch.amendmentId}.json`),
        JSON.stringify(patch, null, 2),
      );

      // 5. Emit event for TUI/Notification
      await this.logger.info(PLAN_AMENDMENT_EVENT_AWAITING_APPROVAL, context.trace_id, {
        amendmentId: patch.amendmentId,
        planId: patch.planId,
        triggerSource: trigger.source,
        affectedStepCount: patch.affectedRemainingStepIds.length,
        createdAt: patch.createdAt,
      });

      // 6. Throw error to pause execution loop
      throw new PlanAmendmentPendingError(
        patch.planId,
        patch.amendmentId,
        `Plan amendment ${patch.amendmentId} proposed for plan ${patch.planId}`,
      );
    }
  }

  /**
   * Get the current HEAD SHA for a portal directory
   */
  private async getPortalHeadSha(path: string): Promise<string | null> {
    try {
      const result = await SafeSubprocess.run("git", [GIT_CMD_REV_PARSE, "HEAD"], {
        cwd: path,
        timeoutMs: DEFAULT_GIT_REV_PARSE_TIMEOUT_MS,
      });
      return result.code === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }
}
