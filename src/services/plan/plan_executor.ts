/**
 * @module PlanExecutor
 * @path src/services/plan/plan_executor.ts
 * @description Orchestrates the Step-by-Step execution of approved plans.
 * Managing the ReAct loop: prompting LLM for actions, executing tools, and committing results.
 * @architectural-layer Services
 * * @related-files [src/services/tool_registry.ts, src/services/execution_loop.ts]
 */

import type { Config } from "../../shared/schemas/config.ts";
import type { IModelProvider } from "../../ai/types.ts";
import type { DatabaseService } from "../core/db.ts";
import { GitService } from "../core/git_service.ts";
import { SafeSubprocess } from "../../helpers/subprocess.ts";
import { EventLogger } from "../core/event_logger.ts";
import { AgentExecutor } from "../agent/agent_executor.ts";
import { PathResolver } from "../portal/path_resolver.ts";
import { PortalPermissionsService } from "../portal/portal_permissions.ts";
import { ActivityActor, ExecutionStatus, SecurityMode } from "../../shared/enums.ts";
import {
  ACTIVITY_ACTOR_AGENT,
  DEFAULT_GIT_REV_PARSE_TIMEOUT_MS,
  GIT_CMD_REV_PARSE,
  GIT_ERROR_NOTHING_TO_COMMIT,
  PORTAL_ALIAS_WORKSPACE,
  PROMPT_PLAN_STEP_REASONING_PREFIX,
  PROMPT_PLAN_STEP_TASK_PREFIX,
  REPORT_GENERATION_MAX_TOKENS,
  REPORT_GENERATION_TEMPERATURE,
} from "../../shared/constants.ts";
import type { JSONValue } from "../../shared/types/json.ts";
import type { IApplicationContext } from "../../shared/interfaces/i_application_context.ts";
import type { IDatabaseService } from "../../shared/interfaces/i_database_service.ts";

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

export class PlanExecutor {
  private logger: EventLogger;
  private enableGit: boolean;
  private generateReport: boolean;
  private config: Config;
  private db: IDatabaseService;

  constructor(
    config: Config,
    private llmProvider: IModelProvider,
    db: IDatabaseService,
    private repoPath: string,
    options: IPlanExecutorOptions = {},
  ) {
    const ctx = options.context;
    this.config = ctx?.config.get() || config;
    this.db = ctx?.db || db;
    this.logger = new EventLogger({
      db: this.db,
      defaultActor: ActivityActor.SYSTEM,
    });
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

    await this.logger.info("plan.execution_started", planPath, {
      trace_id: traceId,
      request_id: requestId,
      step_count: context.steps.length,
    });

    try {
      const git = this.enableGit
        ? new GitService({
          config: this.config,
          db: this.db,
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

        await this.logger.info("plan.execution_completed", planPath, {
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
      await this.logger.error("plan.execution_failed", planPath, {
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
      db: this.db as DatabaseService,
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

    return await this.llmProvider.generate(prompt, {
      temperature: REPORT_GENERATION_TEMPERATURE,
      max_tokens: REPORT_GENERATION_MAX_TOKENS,
    });
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
