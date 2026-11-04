/**
 * @module ExecutionPlanRunner
 * @path packages/execution/src/execution_plan_runner.ts
 * @description Runs the work of a plan for the execution loop: the read-only check, the structured plan through PlanExecutor and the plain tool actions.
 * @architectural-layer Services
 * @related-files [packages/execution/src/execution_loop.ts, packages/execution/tests/execution_loop_test.ts]
 */

import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import type { IApplicationContext, IPlanAmendmentGate, IPlanAmendmentService } from "@exaix/core/types";
import type { IDatabaseService } from "@exaix/core/types";
import type { IPlanAction } from "@exaix/schemas/plan_schema.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType, type TDomainEventType } from "@exaix/core/events";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { ModelResolver } from "@exaix/ai";
import type { IGitService, IToolRegistryFactory } from "@exaix/core/types";
import type { PlanFrontmatter } from "@exaix/schemas/plan_schema.ts";
import type { IBlueprintLoader } from "@exaix/core/blueprint";
import { type IPlanExecutorOptions, PlanExecutor } from "@exaix/core/planning";
import type { IGuardrailRunner } from "./guardrail_runner.ts";
import type { PortalExecutionStrategy } from "@exaix/core";
import type { IModelRegistry } from "@exaix/core/types";
import { type IStructuredPlan, parseStructuredPlanFromMarkdown } from "@exaix/core/planning";
import { isReadOnlyAgentCapabilities } from "@exaix/core/func";
import type { IFixedModelClient } from "@exaix/schemas";
import type { IEffortResolver } from "@exaix/ai";
import type { ConfidenceScorer } from "./confidence_scorer.ts";
import type { GitExecutionSetupService } from "./git_execution_setup_service.ts";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { ExecutionPlanReader } from "./execution_plan_reader.ts";
import type { IExecutionLoopConfig } from "./execution_loop.ts";

/** What the plan execution of one execution loop needs from it. */
interface IExecutionPlanRunnerDependencies {
  readonly config: Config;
  readonly db: Opt<IDatabaseService, Reason.OptionalDependency>;
  readonly logger: Opt<IEventLogger, Reason.OptionalDependency>;
  readonly llmProvider: Opt<IModelProvider, Reason.OptionalDependency>;
  readonly context: Opt<IApplicationContext, Reason.OptionalDependency>;
  readonly confidenceScorer: Opt<ConfidenceScorer, Reason.OptionalDependency>;
  readonly amendmentService: Opt<IPlanAmendmentService, Reason.OptionalDependency>;
  readonly amendmentGate: Opt<IPlanAmendmentGate, Reason.OptionalDependency>;
  readonly onCodeChangesDelegate: Opt<IExecutionLoopConfig["onCodeChangesDelegate"], Reason.OptionalDependency>;
  readonly modelResolver: Opt<ModelResolver, Reason.OptionalDependency>;
  readonly modelRegistry: Opt<IModelRegistry, Reason.OptionalDependency>;
  readonly fixedClient: Opt<IFixedModelClient, Reason.OptionalDependency>;
  readonly effortResolver: Opt<IEffortResolver, Reason.OptionalDependency>;
  readonly guardrailRunner: Opt<IGuardrailRunner, Reason.OptionalDependency>;
  readonly toolRegistryFactory: Opt<IToolRegistryFactory, Reason.OptionalDependency>;
  readonly planReader: ExecutionPlanReader;
  readonly blueprintLoader: IBlueprintLoader;
  readonly gitExecutionSetupService: GitExecutionSetupService;
  readonly journal: (action: TDomainEventType, traceId: string, payload: Record<string, JSONValue>) => void;
}

/** Executes the work of a plan: the structured steps through PlanExecutor, or the plain tool actions. */
export class ExecutionPlanRunner {
  private readonly config: IExecutionPlanRunnerDependencies["config"];
  private readonly db: IExecutionPlanRunnerDependencies["db"];
  private readonly logger: IExecutionPlanRunnerDependencies["logger"];
  private readonly llmProvider: IExecutionPlanRunnerDependencies["llmProvider"];
  private readonly context: IExecutionPlanRunnerDependencies["context"];
  private readonly confidenceScorer: IExecutionPlanRunnerDependencies["confidenceScorer"];
  private readonly amendmentService: IExecutionPlanRunnerDependencies["amendmentService"];
  private readonly amendmentGate: IExecutionPlanRunnerDependencies["amendmentGate"];
  private readonly onCodeChangesDelegate: IExecutionPlanRunnerDependencies["onCodeChangesDelegate"];
  private readonly modelResolver: IExecutionPlanRunnerDependencies["modelResolver"];
  private readonly modelRegistry: IExecutionPlanRunnerDependencies["modelRegistry"];
  private readonly fixedClient: IExecutionPlanRunnerDependencies["fixedClient"];
  private readonly effortResolver: IExecutionPlanRunnerDependencies["effortResolver"];
  private readonly guardrailRunner: IExecutionPlanRunnerDependencies["guardrailRunner"];
  private readonly toolRegistryFactory: IExecutionPlanRunnerDependencies["toolRegistryFactory"];
  private readonly planReader: IExecutionPlanRunnerDependencies["planReader"];
  private readonly blueprintLoader: IExecutionPlanRunnerDependencies["blueprintLoader"];
  private readonly gitExecutionSetupService: IExecutionPlanRunnerDependencies["gitExecutionSetupService"];
  private readonly journal: IExecutionPlanRunnerDependencies["journal"];

  constructor(dependencies: IExecutionPlanRunnerDependencies) {
    this.config = dependencies.config;
    this.db = dependencies.db;
    this.logger = dependencies.logger;
    this.llmProvider = dependencies.llmProvider;
    this.context = dependencies.context;
    this.confidenceScorer = dependencies.confidenceScorer;
    this.amendmentService = dependencies.amendmentService;
    this.amendmentGate = dependencies.amendmentGate;
    this.onCodeChangesDelegate = dependencies.onCodeChangesDelegate;
    this.modelResolver = dependencies.modelResolver;
    this.modelRegistry = dependencies.modelRegistry;
    this.fixedClient = dependencies.fixedClient;
    this.effortResolver = dependencies.effortResolver;
    this.guardrailRunner = dependencies.guardrailRunner;
    this.toolRegistryFactory = dependencies.toolRegistryFactory;
    this.planReader = dependencies.planReader;
    this.blueprintLoader = dependencies.blueprintLoader;
    this.gitExecutionSetupService = dependencies.gitExecutionSetupService;
    this.journal = dependencies.journal;
  }

  private async isReadOnlyAgentId(agentRole: Opt<string, Reason.OptionalInput>): Promise<boolean> {
    if (!agentRole) return false;

    try {
      const blueprint = await this.blueprintLoader.load(agentRole);
      if (!blueprint) return false;
      return isReadOnlyAgentCapabilities(blueprint.capabilities, blueprint.frontmatter.permitted_tools);
    } catch {
      // If blueprint can't be loaded for any reason, fall back to executable behavior
      return false;
    }
  }

  async preparePlanExecution(frontmatter: PlanFrontmatter, planContent: string): Promise<{
    structuredPlan: IStructuredPlan | null;
    actions: IPlanAction[];
    planAgentId: string | undefined;
    isReadOnly: boolean;
    hasExecutableWork: boolean;
    executionStrategy: PortalExecutionStrategy;
  }> {
    const structuredPlan = parseStructuredPlanFromMarkdown(planContent, {
      trace_id: frontmatter.trace_id,
      request_id: frontmatter.request_id,
      agent_role: frontmatter.agent_role,
    });

    const actions = structuredPlan ? [] : this.planReader.parsePlanActions(planContent);
    const planAgentId = frontmatter.agent_role || structuredPlan?.agent;
    if (!frontmatter.agent_role && structuredPlan && planAgentId) {
      console.warn(
        `[ExecutionLoop] plan ${structuredPlan.trace_id} carried no.agent_role; ` +
          `falling back to default agent role "${planAgentId}" for execution`,
      );
    }
    const isReadOnly = await this.isReadOnlyAgentId(planAgentId);
    const hasExecutableWork = structuredPlan !== null || actions.length > 0;
    const executionStrategy = this.gitExecutionSetupService.getExecutionStrategy(frontmatter);

    return { structuredPlan, actions, planAgentId, isReadOnly, hasExecutableWork, executionStrategy };
  }

  async executePlanWork(args: {
    structuredPlan: IStructuredPlan | null;
    actions: IPlanAction[];
    isReadOnly: boolean;
    planAgentId: string | undefined;
    requireActions: boolean;
    traceId: string;
    requestId: string;
    planPath: string;
    executionRoot: string;
    executionGitService: IGitService;
    frontmatter: PlanFrontmatter;
  }): Promise<
    { didExecuteWork: boolean; didMutateRepo: boolean; commitSha?: string; report?: string; completionSummary?: string }
  > {
    if (args.structuredPlan) {
      if (args.isReadOnly && (!this.llmProvider || !this.db)) {
        this.journal(DomainEventType.ExecutionReadonlyPlanSkipped, args.traceId, {
          request_id: args.requestId,
          agent_role: args.planAgentId ?? null,
        });
        return { didExecuteWork: false, didMutateRepo: false };
      }

      const structuredPlanResult = await this.executeStructuredPlan(
        args.structuredPlan,
        args.executionRoot,
        args.executionGitService,
        args.frontmatter,
        args.planPath,
        { enableGit: !args.isReadOnly, generateReport: args.isReadOnly },
      );

      if (args.isReadOnly) {
        this.journal(DomainEventType.ExecutionReadonlyPlanExecuted, args.traceId, {
          request_id: args.requestId,
          agent_role: args.planAgentId ?? null,
        });
      }

      return {
        didExecuteWork: true,
        didMutateRepo: !args.isReadOnly,
        ...(structuredPlanResult.lastCommitSha ? { commitSha: structuredPlanResult.lastCommitSha } : {}),
        report: structuredPlanResult.report,
        completionSummary: structuredPlanResult.report,
      };
    }

    if (args.actions.length === 0) {
      if (args.requireActions) {
        throw new Error("Plan contains no executable actions");
      }
      return { didExecuteWork: false, didMutateRepo: false };
    }

    await this.executePlanActions(args.actions, args.traceId, args.requestId, args.executionRoot);
    return { didExecuteWork: true, didMutateRepo: !args.isReadOnly };
  }

  /**
   * Execute plan actions using ToolRegistry
   */
  private async executePlanActions(
    actions: IPlanAction[],
    traceId: string,
    requestId: string,
    executionRoot: string,
  ): Promise<void> {
    const toolRegistry = this.toolRegistryFactory?.createToolRegistry(traceId, executionRoot) ??
      missingFactory("toolRegistryFactory", "action execution");

    let actionIndex = 0;
    for (const action of actions) {
      actionIndex++;

      this.journal(DomainEventType.ExecutionActionStarted, traceId, {
        request_id: requestId,
        action_index: actionIndex,
        tool: action.tool,
        description: action.description ?? null,
      });

      try {
        const result = await toolRegistry.execute(action.tool, action.params);

        if (!result.success) {
          const errorMessage = result.error ?? "Unknown tool error";

          this.journal(DomainEventType.ExecutionActionFailed, traceId, {
            request_id: requestId,
            action_index: actionIndex,
            tool: action.tool,
            error: errorMessage,
          });

          throw new Error(`Action ${actionIndex} (${action.tool}) failed: ${errorMessage}`);
        }

        this.journal(DomainEventType.ExecutionActionCompleted, traceId, {
          request_id: requestId,
          action_index: actionIndex,
          tool: action.tool,
          result_summary: this.summarizeResult(result.data ?? null),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        this.journal(DomainEventType.ExecutionActionFailed, traceId, {
          request_id: requestId,
          action_index: actionIndex,
          tool: action.tool,
          error: errorMessage,
        });

        // Re-throw to trigger failure handling
        throw new Error(`Action ${actionIndex} (${action.tool}) failed: ${errorMessage}`);
      }
    }
  }

  /**
   * Execute structured plan using PlanExecutor
   */
  async executeStructuredPlan(
    plan: IStructuredPlan,
    executionRoot: string,
    _gitService: IGitService,
    frontmatter: PlanFrontmatter,
    planPath: string,
    options?: Opt<{
      enableGit?: boolean;
      generateReport?: boolean;
      reuseCurrentBranch?: boolean;
      commitCompletion?: boolean;
      disableAmendments?: boolean;
      runPhase?: string;
    }, Reason.ExecutionConfig>,
  ): Promise<{ report?: string; lastCommitSha: string | null }> {
    if (!this.llmProvider) {
      throw new Error("LLM provider required for structured plan execution");
    }
    if (!this.db) {
      throw new Error("Database required for structured plan execution");
    }

    // Create PlanExecutor
    const planExecutorOptions: IPlanExecutorOptions = {
      ...options,
      context: this.context,
      confidenceScorer: this.confidenceScorer,
      amendmentService: this.amendmentService,
      amendmentGate: this.amendmentGate,
      onCodeChangesDelegate: this.onCodeChangesDelegate,
      modelResolver: this.modelResolver,
      modelRegistry: this.modelRegistry,
      ...(this.fixedClient ? { fixedClient: this.fixedClient } : {}),
      // Request-level intent flags ride the plan frontmatter, so native execution overrides blueprint values.
      requestIntent: this.planReader.requestIntentFromPlanFrontmatter(frontmatter),
      requestDeclaration: this.planReader.requestDeclarationFromPlanFrontmatter(
        frontmatter,
        frontmatter.trace_id ?? "",
        planPath,
      ),
      ...(this.effortResolver !== undefined ? { effortResolver: this.effortResolver } : {}),
    };
    if (this.guardrailRunner) {
      planExecutorOptions.guardrailRunner = this.guardrailRunner;
    }
    const planExecutor = new PlanExecutor(
      this.config,
      this.llmProvider,
      this.db,
      executionRoot,
      this.logger,
      planExecutorOptions,
    );

    // Create plan context
    const context = {
      trace_id: plan.trace_id,
      request_id: plan.request_id,
      agent_role: (plan as { agent_role?: string; agent?: string }).agent_role ?? plan.agent,
      frontmatter: this.planReader.toSafeFrontmatter(frontmatter),
      steps: plan.steps,
    };

    // Create a dummy plan path (not used by PlanExecutor for structured execution)
    const dummyPlanPath = join(executionRoot, "plan.md");

    // Execute the plan
    const result = await planExecutor.execute(dummyPlanPath, context);
    return { report: result.report, lastCommitSha: result.lastCommitSha };
  }

  /**
   * Create a safe summary of tool execution result for logging
   */
  private summarizeResult(result: Opt<JSONValue | null, Reason.OptionalInput>): string {
    if (result === null || result === undefined) {
      return "null";
    }

    if (typeof result === "string") {
      return result.length > 100 ? `${result.substring(0, 100)}...` : result;
    }

    if (typeof result === "object") {
      const json = JSON.stringify(result);
      return json.length > 100 ? `${json.substring(0, 100)}...` : json;
    }

    return String(result);
  }
}

/** Fails fast when a factory that the work needs was not provided. */
export function missingFactory(name: string, context: string): never {
  throw new Error(
    `ExecutionLoop: ${name} factory is required for ${context}. Provide \`${name}\` in IExecutionLoopConfig.`,
  );
}
