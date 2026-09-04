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
import { resolveMemoryExecutionRoot } from "../config/paths.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { ModelResolver } from "@exaix/ai";
import type { IModelIntent } from "@exaix/schemas/model_intent.ts";
import type { DatabaseService } from "@exaix/storage-sqlite";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import { SafeSubprocess } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import type { ConfidenceScorer } from "@exaix/execution";
import { DEFAULT_AMENDMENT_THRESHOLD, ExecutionStatus, SecurityMode } from "@exaix/core";
import {
  ACTIVITY_ACTOR_AGENT,
  AMENDMENT_ARTIFACTS_DIR,
  PLAN_AMENDMENT_EVENT_AWAITING_APPROVAL,
  PORTAL_ALIAS_WORKSPACE,
  PROMPT_PLAN_STEP_REASONING_PREFIX,
  PROMPT_PLAN_STEP_TASK_PREFIX,
  REPORT_GENERATION_MAX_TOKENS,
  REPORT_GENERATION_TEMPERATURE,
} from "@exaix/core";
import { DEFAULT_GIT_REV_PARSE_TIMEOUT_MS, GIT_ERROR_NOTHING_TO_COMMIT, GitService } from "@exaix/git";
import { GIT_CMD_REV_PARSE } from "@exaix/git/constants.ts";
import type { JSONValue } from "@exaix/core";
import type { IApplicationContext, IPlanAmendmentGate, IPlanAmendmentService } from "@exaix/core/types";
import type { IDatabaseService, IModelRegistry } from "@exaix/core/types";
import { TaskType } from "@exaix/core/types";
import {
  AgentComposer,
  ContextBudgetManager,
  ExecutionContextService,
  type IAgentComposerOptions,
  type IGuardrailRunner,
} from "@exaix/execution";
import { PromptBudgetAllocator } from "@exaix/core";
import { ToolRegistry } from "@exaix/tool-runtime";
import { PlanAmendmentService } from "./plan_amendment_service.ts";
import { PlanAmendmentGate } from "./plan_amendment_gate.ts";
import type { IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";
import { GuardrailBlockedError, PlanAmendmentPendingError } from "./errors.ts";

export interface IPlanStep {
  number: number;
  title: string;
  content: string;
  /** Success criteria for this step; when populated, the daemon-side callback
   *  uses these as acceptanceCriteria for the delegate brief. */
  successCriteria?: string[];
}

export interface IPlanContext {
  trace_id: string;
  request_id: string;
  agent_role: string;
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
  amendmentGate?: IPlanAmendmentGate;
  /** Optional guardrail runner. When provided, built in createAgentExecutor. */
  guardrailRunner?: IGuardrailRunner;
  /** Request-level IModelIntent fields that override blueprint values. */
  requestIntent?: Partial<IModelIntent>;
  /** Resolver threaded into AgentComposer so resolveModelFromBlueprint's
   *  ModelResolver.resolve() branch is reachable during real execution — without it,
   *  best/route/auto-admit/task_type derivation never fires, regardless of blueprint content. */
  modelResolver?: ModelResolver;
  /** Edition-selected registry threaded into AgentComposer's PromptBudgetAllocator so
   *  context-window resolution reaches production instead of the hardcoded 128K fallback —
   *  without it every allocate() call ignores the resolved model's real context window. */
  modelRegistry?: IModelRegistry;
  /** Invoked when a code-changes delegation result is reconciled; lets PlanExecutor delegate
   *  code-change steps to a foreign agent without importing the concrete launcher. `worktreePath`
   *  is PlanExecutor's real git worktree, so the delegate spawns where it actually exists. */
  onCodeChangesDelegate?: (
    traceId: string,
    step: { number: number; title: string; content: string; successCriteria?: string[] },
    worktreePath: string,
    agentRole: string,
  ) => Promise<string>;
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

/** Reads `tags` off a plan context's frontmatter for skill trigger matching (untyped JSON map;
 *  YAML admits either a list or a lone string). */
function frontmatterTags(context: IPlanContext): string[] | undefined {
  const raw = context.frontmatter?.tags;
  if (Array.isArray(raw)) {
    const tags = raw.map((tag) => String(tag).trim()).filter((tag) => tag.length > 0);
    return tags.length > 0 ? tags : undefined;
  }
  if (typeof raw === "string" && raw.trim().length > 0) return [raw.trim()];
  return undefined;
}

/** Concatenates every step's title and content into one document, passed as
 *  IExecutionContext.full_plan so a whole-task-at-once strategy (CliDelegateStrategy) can
 *  orient on the complete plan; ReAct/legacy strategies ignore it. */
export function buildFullPlanText(steps: IPlanStep[]): string {
  return steps
    .map((step) => `${PROMPT_PLAN_STEP_TASK_PREFIX}${step.title}${PROMPT_PLAN_STEP_REASONING_PREFIX}${step.content}`)
    .join("\n\n---\n\n");
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
    logger?: Opt<IEventLogger, Reason.OptionalDependency>,
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
  async execute(
    planPath: string,
    context: IPlanContext,
  ): Promise<IPlanExecutionResult> {
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
          agentRole: context.agent_role,
        })
        : null;

      if (git) {
        await git.ensureRepository();
        await git.ensureIdentity();
        await git.createBranch({ requestId, traceId });
      }

      const initialHeadSha = git ? await this.getPortalHeadSha(this.repoPath) : null;
      const portalName = this.resolvePortalName(context.frontmatter.portal);
      const agentExecutor = await this.createAgentExecutor(traceId, context);

      try {
        const lastCommitSha = await this.executeSteps(
          context,
          portalName,
          git,
          agentExecutor,
          actionReports,
        );

        if (git) {
          await this.commitPlanCompletion(
            git,
            requestId,
            traceId,
            context.agent_role,
          );
        }

        await this.logger.info(
          DomainEventType.PlanExecutionCompleted,
          planPath,
          {
            trace_id: traceId,
            status: ExecutionStatus.COMPLETED,
            last_commit: lastCommitSha === initialHeadSha ? null : lastCommitSha,
          },
        );

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
  private resolvePortalName(frontmatterPortal: Opt<JSONValue, Reason.OptionalInput>): string {
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
   * Create an AgentComposer instance with proper dependencies.
   */
  private async createAgentExecutor(traceId: string, context: IPlanContext): Promise<AgentComposer> {
    const pathResolver = new PathResolver(this.config, {
      traceId,
    });
    const permissions = new PortalPermissionsService(this.config.portals);

    const options: IAgentComposerOptions = {};
    if (this.options.guardrailRunner) {
      options.guardrailRunner = this.options.guardrailRunner;
    }
    if (this.options.requestIntent) {
      options.requestIntent = this.options.requestIntent;
    }
    const topSkillTaskTypes = await this.deriveTopSkillTaskTypes(context);
    if (topSkillTaskTypes.length > 0) {
      options.topSkillTaskTypes = topSkillTaskTypes;
    }
    const matchedSkillTools = await this.deriveMatchedSkillTools(context);
    if (matchedSkillTools.length > 0) {
      options.matchedSkillTools = matchedSkillTools;
    }

    // Builds the allocator here (rather than leaving it undefined) so it carries the
    // edition-selected registry, bypassing AgentComposer's own default construction.
    // When modelRegistry is absent, undefined passes through and that default still applies.
    const promptBudgetAllocator = this.options.modelRegistry
      ? new PromptBudgetAllocator(this.config.budget_enforcement, undefined, this.logger, this.options.modelRegistry)
      : undefined;

    return new AgentComposer({
      config: this.config,
      db: this.db as DatabaseService,
      logger: this.logger,
      pathResolver,
      permissions,
      provider: this.llmProvider,
      toolRegistry: new ToolRegistry({
        config: this.config,
        traceId,
        baseDir: this.repoPath,
        pathResolver,
        gitServiceFactory: {
          createGitService: (repoPath: string, gitTraceId: string) =>
            new GitService({ config: this.config, repoPath, traceId: gitTraceId }),
        },
      }),
      options,
      modelResolver: this.options.modelResolver,
      executionContext: new ExecutionContextService(this.config, this.logger, {
        promptBudgetAllocator,
        contextBudgetManager: new ContextBudgetManager(undefined, undefined, undefined, this.logger),
      }),
    });
  }

  /** Reachability Ledger: resolves the skill-trigger tier of deriveTaskType's precedence
   *  chain by re-running the same skill match against the plan's request subject via
   *  SkillsService; returns [] when unconfigured, unmatched, or no TaskType recognised. */
  private async deriveTopSkillTaskTypes(context: IPlanContext): Promise<TaskType[]> {
    const skills = this.options.context?.skills;
    const requestText = context.frontmatter.subject;
    if (!skills || typeof requestText !== "string" || requestText.length === 0) {
      return [];
    }

    const { matches } = await skills.matchSkills({
      requestText,
      // Frontmatter tags are a first-class trigger input; sending requestText alone left the
      // matcher with nothing but extracted keywords and returned 0 matches on requests whose
      // tags named a skill outright.
      tags: frontmatterTags(context),
      agentRole: context.agent_role,
    });
    const topMatch = matches[0];
    const candidateTaskTypes = topMatch?.matchedTriggers.task_types ?? [];
    const knownTaskTypes = new Set<string>(Object.values(TaskType));
    return candidateTaskTypes.filter((value): value is TaskType => knownTaskTypes.has(value));
  }

  /** Re-runs the same skill match as deriveTopSkillTaskTypes (kept separate to leave that
   *  method's tested behaviour untouched), then fetches each match's full ISkill for its
   *  `tools`; returns one array per match, unioned/intersected with permitted_tools by the caller. */
  private async deriveMatchedSkillTools(context: IPlanContext): Promise<Array<string[] | undefined>> {
    const skills = this.options.context?.skills;
    const requestText = context.frontmatter.subject;
    if (!skills || typeof requestText !== "string" || requestText.length === 0) {
      return [];
    }

    const { matches } = await skills.matchSkills({
      requestText,
      tags: frontmatterTags(context),
      agentRole: context.agent_role,
    });

    return await Promise.all(
      matches.map(async (match) => {
        const skill = await skills.getSkill(match.skillId);
        return skill?.tools;
      }),
    );
  }

  /** Executes all plan steps sequentially, collecting action reports; returns the last successful commit SHA. */
  private async executeSteps(
    context: IPlanContext,
    portalName: string,
    git: GitService | null,
    agentExecutor: AgentComposer,
    actionReports: IPlanActionReport[],
  ): Promise<string | null> {
    const traceId = context.trace_id;
    const requestId = context.request_id;
    let lastCommitSha: string | null = null;
    const fullPlan = buildFullPlanText(context.steps);

    for (const step of context.steps) {
      try {
        let result: { description: string } | undefined;

        const delegateOutcome = await this._tryDelegateStep(step, traceId, actionReports, context.agent_role);
        if (delegateOutcome.skip) continue;
        if (delegateOutcome.result) {
          result = delegateOutcome.result;
        }

        if (!result) {
          result = await agentExecutor.executeStep(
            {
              trace_id: traceId,
              request_id: requestId,
              request: step.content,
              plan: `${PROMPT_PLAN_STEP_TASK_PREFIX}${step.title}${PROMPT_PLAN_STEP_REASONING_PREFIX}${step.content}`,
              portal: portalName,
              full_plan: fullPlan,
            },
            {
              agent_role: context.agent_role,
              portal: portalName,
              security_mode: SecurityMode.HYBRID,
              audit_enabled: true,
              native_tools_enabled: this.config.execution?.native_tools_enabled ?? false,
            },
          );
        }

        if (this.options.confidenceScorer && this.config.amendment?.enabled) {
          const assessment = this.options.confidenceScorer.assessQuick(
            result.description,
          );
          const threshold = this.config.amendment.threshold ??
            DEFAULT_AMENDMENT_THRESHOLD;

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
        if (
          this.config.amendment?.enabled &&
          !(error instanceof PlanAmendmentPendingError)
        ) {
          const source = error instanceof GuardrailBlockedError ? "guardrail_violation" : "tool_error";
          await this.handleAmendmentTrigger(
            {
              source,
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

  private async _tryDelegateStep(
    step: IPlanStep,
    traceId: string,
    actionReports: IPlanActionReport[],
    agentRole: string,
  ): Promise<{ skip: boolean; result?: { description: string } }> {
    if (!this.options.onCodeChangesDelegate) {
      return { skip: false };
    }
    const delegateResult = await this.options.onCodeChangesDelegate(
      traceId,
      {
        number: step.number,
        title: step.title,
        content: step.content,
        successCriteria: step.successCriteria ?? undefined,
      },
      this.repoPath,
      agentRole,
    );
    if (delegateResult === "changes_made") {
      return {
        skip: false,
        result: { description: `Delegated step ${step.number}: ${step.title} (changes_made)` },
      };
    }
    actionReports.push({
      stepNumber: step.number,
      stepTitle: step.title,
      tool: "delegated",
      params: { request: step.content },
      success: false,
      output: "delegated and abandoned",
    });
    return { skip: true };
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
      if (
        !(error instanceof Error &&
          error.message.includes(GIT_ERROR_NOTHING_TO_COMMIT))
      ) {
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
    agentRole: string,
  ): Promise<void> {
    try {
      await git.commit({
        message: `Complete plan: ${requestId}`,
        description: `Executed by agent role ${agentRole}`,
        traceId,
      });
    } catch (error) {
      if (
        !(error instanceof Error &&
          error.message.includes(GIT_ERROR_NOTHING_TO_COMMIT))
      ) {
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
    const service = this.options.amendmentService ||
      new PlanAmendmentService(this.config, this.llmProvider);
    const gate = this.options.amendmentGate ??
      new PlanAmendmentGate(this.config, service, undefined, this.logger);

    if (await service.shouldAmend(trigger)) {
      await this.logger.info(
        DomainEventType.PlanAmendmentTriggered,
        context.trace_id,
        {
          source: trigger.source,
          reason: trigger.reason,
          stepId: trigger.stepId,
        },
      );

      // 1. Compute remaining steps
      const remainingSteps = context.steps.filter((s) => s.number > _currentStep.number);

      // 2. Propose amendment
      const patch = await gate.proposeAmendment({
        planId: context.request_id,
        stepLabel: String(_currentStep.number),
        remainingSteps,
        trigger,
        traceId: context.trace_id,
      });

      // 4. Persist amendment artifact
      const executionRoot = resolveMemoryExecutionRoot(this.config.paths);

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
      await this.logger.info(
        PLAN_AMENDMENT_EVENT_AWAITING_APPROVAL,
        context.trace_id,
        {
          amendmentId: patch.amendmentId,
          planId: patch.planId,
          triggerSource: trigger.source,
          affectedStepCount: patch.affectedRemainingStepIds.length,
          createdAt: patch.createdAt,
        },
      );

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
      const result = await SafeSubprocess.run("git", [
        GIT_CMD_REV_PARSE,
        "HEAD",
      ], {
        cwd: path,
        timeoutMs: DEFAULT_GIT_REV_PARSE_TIMEOUT_MS,
      });
      return result.code === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }
}
