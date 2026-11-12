/**
 * @module AgentRunnerPlanningTools
 * @path packages/execution/src/agent_runner_planning_tools.ts
 * @description The planning tools path of one agent run: the gate that decides whether the tool loop engages and the loop that it drives.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_runner.ts, packages/execution/src/planning_tool_loop.ts]
 */

import type { ICallSite, IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { toolsRoundPolicyReader } from "@exaix/schemas";
import type { IToolRegistryFactory } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import { PlanningToolLoopStopReason, PlanningToolsSkipReason, PortalOperation } from "@exaix/core";
import { checkPortalOperationAllowed } from "@exaix/portal";
import { readOnlyEditorTools } from "@exaix/tool-runtime";
import type { IPortalPermissions } from "@exaix/schemas/portal_permissions.ts";
import { PlanningToolLoop } from "./planning_tool_loop.ts";
import type { IGuardrailRunner } from "./guardrail_runner.ts";
import { providerSupportsNativeTools } from "./native_tool_turns.ts";
import type { IApplicationContext } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import type { IPromptBudget } from "@exaix/schemas/prompt_budget.ts";
import type { ITokenizer } from "@exaix/core/func";
import { DomainEventType } from "@exaix/core/events";
import type { IRetryResult } from "@exaix/core/request";
import type { Opt, Reason } from "@exaix/core/types";
import { ToolsRoundLoop } from "@exaix/core";
import type { IParsedRequest } from "./agent_runner.ts";
import type { AgentRunnerSkills, ISkillUsagePlan } from "./agent_runner_skills.ts";
import { buildGenerateOptions, type IGenerationHints } from "./agent_runner_generation_hints.ts";

/** The slice of the runner configuration that the planning tools path reads. */
interface IPlanningToolsConfig {
  readonly selectedModel?: { provider: string };
  readonly context?: IApplicationContext;
  readonly tokenizer?: ITokenizer;
  readonly plannerToolRegistryFactory?: IToolRegistryFactory;
  readonly guardrailRunner?: IGuardrailRunner;
}

/** Where the tool loop takes the call site of each round and returns it once the response is consumed. */
interface ICallSiteSource {
  resolve(request: IParsedRequest): ICallSite | undefined;
  consume(callSite: Opt<ICallSite, Reason.OptionalContext>): void;
}

/** What the planning tools path of one runner needs from it. */
interface IAgentRunnerPlanningToolsDependencies {
  readonly config: Opt<IPlanningToolsConfig, Reason.OptionalDependency>;
  readonly modelProvider: IModelProvider;
  readonly logger: Opt<IEventLogger, Reason.OptionalDependency>;
  readonly skills: Pick<AgentRunnerSkills, "withSkillUsage">;
  readonly callSites: ICallSiteSource;
  readonly modelId: () => string;
  /** The retry-wrapped generation that the single-call path also uses. */
  readonly runGeneration: (
    fn: () => Promise<IGenerateResult>,
    startTime: number,
  ) => Promise<IRetryResult<IGenerateResult>>;
  readonly journal: (
    action: string,
    target: string | null,
    payload: Record<string, JSONValue>,
    traceId: Opt<string, Reason.TraceAbsent>,
    agentRole: string,
  ) => void;
}

/** The planning tools path of one agent runner: its gate and its tool loop. */
export class AgentRunnerPlanningTools {
  private readonly config: IAgentRunnerPlanningToolsDependencies["config"];
  private readonly modelProvider: IModelProvider;
  private readonly logger: IAgentRunnerPlanningToolsDependencies["logger"];
  private readonly skills: IAgentRunnerPlanningToolsDependencies["skills"];
  private readonly callSites: IAgentRunnerPlanningToolsDependencies["callSites"];
  private readonly modelId: () => string;
  private readonly runGeneration: IAgentRunnerPlanningToolsDependencies["runGeneration"];
  private readonly journal: IAgentRunnerPlanningToolsDependencies["journal"];

  constructor(dependencies: IAgentRunnerPlanningToolsDependencies) {
    this.config = dependencies.config;
    this.modelProvider = dependencies.modelProvider;
    this.logger = dependencies.logger;
    this.skills = dependencies.skills;
    this.callSites = dependencies.callSites;
    this.modelId = dependencies.modelId;
    this.runGeneration = dependencies.runGeneration;
    this.journal = dependencies.journal;
  }

  /** Decides whether the tools path engages. A skip can carry a reason for the journal. */
  resolvePlanningGate(
    request: IParsedRequest,
    agentRole: string,
  ): { engage: true; portal: IPortalPermissions } | { engage: false; reason?: PlanningToolsSkipReason } {
    const planning = this.config?.context?.config.get().planning;
    if (!planning?.tools_enabled || planning.max_tool_rounds <= 1) return { engage: false };

    const providerId = this.config?.selectedModel?.provider ?? this.modelProvider.id;
    if (!providerSupportsNativeTools(providerId)) {
      return { engage: false, reason: PlanningToolsSkipReason.PROVIDER_UNSUPPORTED };
    }

    if (!request.portal) return { engage: false, reason: PlanningToolsSkipReason.NO_PORTAL };
    const portals = this.config?.context?.config.get().portals ?? [];
    const portal = portals.find((p) => p.alias === request.portal);
    if (!portal) return { engage: false, reason: PlanningToolsSkipReason.NO_PORTAL };

    if (!this.config?.plannerToolRegistryFactory || !this.config?.tokenizer) {
      return { engage: false, reason: PlanningToolsSkipReason.NO_REGISTRY };
    }

    const permission = checkPortalOperationAllowed([portal], portal.alias, agentRole, PortalOperation.READ);
    if (!permission.allowed) return { engage: false, reason: PlanningToolsSkipReason.PORTAL_READ_DENIED };

    return { engage: true, portal };
  }

  /** Drives the tool loop when the gate engages. Returns undefined to fall back to the single call.
   *  Journals `planning.tools.skipped` when the gate denies a request that enabled the flag. */
  async runPlanningToolsIfGated(
    request: IParsedRequest,
    agentRole: string,
    combinedPrompt: string,
    startTime: number,
    hints: IGenerationHints,
    dispatch: { promptBudget: IPromptBudget; usage: ISkillUsagePlan | null },
  ): Promise<IRetryResult<IGenerateResult> | undefined> {
    const { promptBudget, usage } = dispatch;
    const gate = this.resolvePlanningGate(request, agentRole);
    const traceId = hints.conversationId;
    if (!gate.engage) {
      if (gate.reason) {
        this.journal(
          DomainEventType.PlanningToolsSkipped,
          request.requestId ?? null,
          { reason: gate.reason },
          traceId,
          agentRole,
        );
      }
      return undefined;
    }

    const planning = this.config!.context!.config.get().planning!;
    const registry = this.config!.plannerToolRegistryFactory!.createToolRegistry(
      traceId ?? "",
      gate.portal.target_path,
    );
    const allowedTools = new Set(readOnlyEditorTools().map((t) => t.name));
    const baseOptions = buildGenerateOptions({ ...hints, callSite: undefined }) ?? {};

    const loop = new PlanningToolLoop({
      toolRegistry: registry,
      tokenizer: this.config!.tokenizer!,
      toolsRoundPolicy: toolsRoundPolicyReader(this.config!.context!, ToolsRoundLoop.PLANNING),
      modelId: this.modelId(),
      generate: (prompt, options) =>
        this.runGeneration(
          this.skills.withSkillUsage(usage, () => this.modelProvider.generate(prompt, options)),
          startTime,
        ).then((r) => {
          if (!r.success) throw r.error ?? new Error("Planning tool round failed");
          return r.value!;
        }),
      logger: this.logger,
      guardrailRunner: this.config!.guardrailRunner,
      providerId: this.modelProvider.id,
      measureInputTokens: this.modelProvider.measureInputTokens?.bind(this.modelProvider),
    });

    let lastCallSite: Opt<ICallSite, Reason.TraceAbsent> = undefined;
    const result = await loop.run({
      prompt: combinedPrompt,
      baseOptions,
      nextCallSite: () => {
        if (lastCallSite) this.callSites.consume(lastCallSite);
        lastCallSite = this.callSites.resolve(request);
        return lastCallSite;
      },
      portalAlias: gate.portal.alias,
      portalRoot: gate.portal.target_path,
      allowedTools,
      maxRounds: planning.max_tool_rounds,
      maxToolResultTokens: planning.max_tool_result_tokens,
      maxToolCallsPerRound: planning.max_tool_calls_per_round,
      traceId: traceId ?? "",
      promptBudget,
    });
    this.callSites.consume(lastCallSite);

    // A provider that ignored toolChoice leaves no plan text. A retry would repeat it, so fall back.
    if (result.stopReason === PlanningToolLoopStopReason.EMPTY_FINAL) return undefined;

    return {
      success: true,
      value: result.final,
      totalAttempts: result.rounds,
      totalTimeMs: Date.now() - startTime,
      retryHistory: [],
    };
  }
}
