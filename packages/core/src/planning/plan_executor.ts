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
  PLAN_AMENDMENT_EVENT_PROPOSED,
  PORTAL_ALIAS_WORKSPACE,
  PROMPT_PLAN_STEP_REASONING_PREFIX,
  PROMPT_PLAN_STEP_TASK_PREFIX,
  REPORT_GENERATION_MAX_TOKENS,
  REPORT_GENERATION_TEMPERATURE,
} from "@exaix/core";
import { DEFAULT_GIT_REV_PARSE_TIMEOUT_MS, GIT_ERROR_NOTHING_TO_COMMIT, GitService } from "@exaix/git";
import { GIT_CMD_REV_PARSE } from "@exaix/git/constants.ts";
import type { JSONValue } from "@exaix/core";
import type { IApplicationContext, IPlanAmendmentService } from "@exaix/core/types";
import type { IDatabaseService, IModelRegistry } from "@exaix/core/types";
import { TaskType } from "@exaix/core/types";
import {
  AgentOrchestrator,
  ExecutionContextService,
  type IAgentOrchestratorOptions,
  type IGuardrailRunner,
} from "@exaix/execution";
import { PromptBudgetAllocator } from "@exaix/core";
import { ToolRegistry } from "@exaix/tool-runtime";
import { PlanAmendmentService } from "./plan_amendment_service.ts";
import type { IPlanAmendmentTrigger } from "@exaix/schemas/plan_amendment.ts";
import { GuardrailBlockedError, PlanAmendmentPendingError } from "./errors.ts";

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
  /** Optional guardrail runner. When provided, built in createAgentExecutor. */
  guardrailRunner?: IGuardrailRunner;
  /** Request-level IModelIntent fields that override blueprint values (Phase 132). */
  requestIntent?: Partial<IModelIntent>;
  /**
   * Phase 135 Step 9 (GAP-C9): the resolver threaded into AgentOrchestrator so
   * resolveModelFromBlueprint's ModelResolver.resolve() branch is reachable during real
   * plan execution — without it, best/route/auto-admit/task_type derivation is
   * unreachable regardless of identity blueprint content.
   */
  modelResolver?: ModelResolver;
  /**
   * Phase 135 Step 11 (GAP-10, context-window half): the edition-selected registry
   * threaded into AgentOrchestrator's internally-constructed PromptBudgetAllocator, so a
   * step's real context-window resolution reaches production instead of always
   * falling back to the hardcoded 128K default — without it, PromptBudgetAllocator
   * never receives a registry and every allocate() call takes the fallback branch
   * regardless of the resolved model's real context window.
   */
  modelRegistry?: IModelRegistry;
  /**
   * Optional callback invoked when a code-changes delegation result is
   * reconciled. PlanExecutor calls this to delegate code-change steps to a
   * foreign agent without importing the concrete launcher (layer-boundary seam).
   * `worktreePath` is PlanExecutor's executionRoot — the real git worktree the
   * execution loop created — so the delegate spawns in the directory that exists
   * (not a recomputed one). Phase 111 Step 7; LIVE-RT worktree-path fix.
   */
  onCodeChangesDelegate?: (traceId: string, stepId: string, worktreePath: string) => Promise<string>;
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
            context.identity,
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
   * Create an AgentOrchestrator instance with proper dependencies.
   */
  private async createAgentExecutor(traceId: string, context: IPlanContext): Promise<AgentOrchestrator> {
    const pathResolver = new PathResolver(this.config, {
      traceId,
    });
    const permissions = new PortalPermissionsService(this.config.portals);

    const options: IAgentOrchestratorOptions = {};
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

    // Phase 135 Step 11 (GAP-10, context-window half): build the allocator here (rather
    // than leaving it undefined) so AgentOrchestrator's default construction
    // (`promptBudgetAllocator ?? new PromptBudgetAllocator(...)`) is bypassed with one
    // that carries the edition-selected registry. When modelRegistry is absent (e.g.
    // tests that don't inject one), pass undefined through unchanged — AgentOrchestrator's
    // own default still applies, preserving prior behavior exactly.
    const promptBudgetAllocator = this.options.modelRegistry
      ? new PromptBudgetAllocator(this.config.budget_enforcement, undefined, this.logger, this.options.modelRegistry)
      : undefined;

    return new AgentOrchestrator({
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
      executionContext: new ExecutionContextService(this.config, this.logger, { promptBudgetAllocator }),
    });
  }

  /**
   * Reachability Ledger (Phase 135): resolve the skill-trigger tier of
   * deriveTaskType's precedence chain by re-running the same skill match the request
   * already went through — using the plan's originating request subject (frontmatter.subject,
   * carried through from RequestProcessor) against the application context's SkillsService,
   * which is available here via IPlanExecutorOptions.context but was previously never called
   * from PlanExecutor's path. Returns [] (not populated on options) when no skills service is
   * configured, no match is found, or a match's triggers carry no recognised TaskType value.
   */
  private async deriveTopSkillTaskTypes(context: IPlanContext): Promise<TaskType[]> {
    const skills = this.options.context?.skills;
    const requestText = context.frontmatter.subject;
    if (!skills || typeof requestText !== "string" || requestText.length === 0) {
      return [];
    }

    const { matches } = await skills.matchSkills({
      requestText,
      identityId: context.identity,
    });
    const topMatch = matches[0];
    const candidateTaskTypes = topMatch?.matchedTriggers.task_types ?? [];
    const knownTaskTypes = new Set<string>(Object.values(TaskType));
    return candidateTaskTypes.filter((value): value is TaskType => knownTaskTypes.has(value));
  }

  /**
   * Re-runs the same skill match as deriveTopSkillTaskTypes (a second matchSkills call —
   * kept separate rather than sharing one call, to leave deriveTopSkillTaskTypes's existing,
   * tested behaviour untouched), then fetches each matched skill's full ISkill to read its
   * `tools` declaration. Returns one array per match (in match order) for
   * AgentOrchestrator's matchedSkillTools option, which unions and intersects them with the
   * identity's permitted_tools — see skill_tools_derivation.ts. Returns [] when no skills
   * service is configured or no request subject is available.
   */
  private async deriveMatchedSkillTools(context: IPlanContext): Promise<Array<string[] | undefined>> {
    const skills = this.options.context?.skills;
    const requestText = context.frontmatter.subject;
    if (!skills || typeof requestText !== "string" || requestText.length === 0) {
      return [];
    }

    const { matches } = await skills.matchSkills({
      requestText,
      identityId: context.identity,
    });

    return await Promise.all(
      matches.map(async (match) => {
        const skill = await skills.getSkill(match.skillId);
        return skill?.tools;
      }),
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
    agentExecutor: AgentOrchestrator,
    actionReports: IPlanActionReport[],
  ): Promise<string | null> {
    const traceId = context.trace_id;
    const requestId = context.request_id;
    let lastCommitSha: string | null = null;

    for (const step of context.steps) {
      try {
        let result: { description: string } | undefined;

        const delegateOutcome = await this._tryDelegateStep(step, traceId, actionReports);
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
            },
            {
              identity_id: context.identity,
              portal: portalName,
              security_mode: SecurityMode.HYBRID,
              audit_enabled: true,
            },
          );
        }

        // Step 66.2: Low Confidence Trigger Detection
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
        // Step 66.2: Tool Error / Guardrail Block Trigger Detection
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
  ): Promise<{ skip: boolean; result?: { description: string } }> {
    if (!this.options.onCodeChangesDelegate) {
      return { skip: false };
    }
    const delegateResult = await this.options.onCodeChangesDelegate(traceId, String(step.number), this.repoPath);
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
    identityId: string,
  ): Promise<void> {
    try {
      await git.commit({
        message: `Complete plan: ${requestId}`,
        description: `Executed by identity ${identityId}`,
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
