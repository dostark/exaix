/**
 * @module AgentComposerEffort
 * @path packages/execution/src/agent_composer_effort.ts
 * @description Resolves declaration-time effort and thinking for one composed agent step, projects it onto the call options and journals it.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_composer.ts, packages/execution/src/effort_resolution_payload.ts]
 */

import type { Config } from "@exaix/schemas/config.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IAgentExecutionOptions } from "@exaix/schemas/agent_composer.ts";
import type { Opt, Reason } from "@exaix/core/types";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import {
  COMPLEXITY_SOURCE_ANALYSIS,
  COMPLEXITY_SOURCE_DEFAULT,
  ProviderRegistry,
  readProviderModelInfo,
  resolveProviderType,
  taskComplexityFromAnalysis,
} from "@exaix/ai";
import type { IEffortResolution, IEffortResolver } from "@exaix/ai";
import { buildAgentEffortResolvedPayload } from "./effort_resolution_payload.ts";
import { type IProjectedCallOptions, projectResolvedCallOptions } from "@exaix/ai";
import type { IAgentComposerOptions, IAgentFileBlueprint } from "./agent_composer.ts";

// unslop-ignore-next-line unused-type
/** The declaration-time effort and thinking of one step, projected onto the call options. */
export interface IStepEffort {
  resolution: IEffortResolution;
  projection: IProjectedCallOptions;
}

/** What the effort steps of one composer need from it. */
interface IAgentComposerEffortDependencies {
  readonly config: Config;
  readonly logger: IEventLogger;
  readonly effortResolver: IEffortResolver;
  readonly provider: Opt<IModelProvider, Reason.OptionalDependency>;
  readonly options: Opt<IAgentComposerOptions, Reason.OptionalDependency>;
}

/** Resolves, projects and journals the effort and thinking of one composed step. */
export class AgentComposerEffort {
  private readonly config: Config;
  private readonly logger: IEventLogger;
  private readonly effortResolver: IEffortResolver;
  private readonly provider: IAgentComposerEffortDependencies["provider"];
  private readonly options: IAgentComposerEffortDependencies["options"];

  constructor(dependencies: IAgentComposerEffortDependencies) {
    this.config = dependencies.config;
    this.logger = dependencies.logger;
    this.effortResolver = dependencies.effortResolver;
    this.provider = dependencies.provider;
    this.options = dependencies.options;
  }

  /** Resolves the step's effort, projects it onto the provider's call capabilities and journals the resolution. */
  async resolve(
    blueprint: IAgentFileBlueprint,
    options: IAgentExecutionOptions,
    traceId: string,
  ): Promise<IStepEffort> {
    const resolution = await this.resolveEffort(blueprint, options);
    const projection = projectResolvedCallOptions(resolution, {
      request: this.options?.requestDeclaration,
      role: { effort: blueprint.effort, thinking: blueprint.thinking },
      flowStep: { effort: options.effort, thinking: options.thinking },
    }, this.provider?.callCapabilities);
    this.journalEffort(resolution, blueprint, options, traceId, projection);
    return { resolution, projection };
  }

  /** Resolves the execution call's declaration-time effort and thinking. The request declaration wins over the blueprint's.
   *  TaskComplexity comes from the persisted request_analysis. */
  private async resolveEffort(
    blueprint: IAgentFileBlueprint,
    options: IAgentExecutionOptions,
  ): Promise<IEffortResolution> {
    const providerType = resolveProviderType(blueprint.provider);
    const metadata = providerType !== undefined ? ProviderRegistry.getProviderMetadata(providerType) : undefined;
    const modelInfo = await readProviderModelInfo(metadata, blueprint.model);
    const analysis = options.request_analysis as IRequestAnalysis | undefined;
    return this.effortResolver.resolve(
      {
        request: this.options?.requestDeclaration,
        role: { effort: blueprint.effort, thinking: blueprint.thinking },
        flowStep: { effort: options.effort, thinking: options.thinking },
      },
      {
        taskComplexity: taskComplexityFromAnalysis(analysis?.complexity),
        complexitySource: analysis ? COMPLEXITY_SOURCE_ANALYSIS : COMPLEXITY_SOURCE_DEFAULT,
        modelSize: blueprint.modelSize,
        providerType,
        model: blueprint.model,
        providerSupportsThinking: modelInfo?.supportsThinking ?? this.provider?.callCapabilities?.supportsThinking ??
          metadata?.supportsThinking === true,
        anthropicThinkingDefault: this.config.ai_anthropic?.thinking_default,
        skillFloors: this.options?.matchedSkillFloors ?? [],
        agentRole: options.agent_role,
      },
    );
  }

  /** Journals the execution path's effort resolution as agent.effort_resolved, joinable by the plan's traceId.
   *  buildAgentEffortResolvedPayload owns the payload shape. */
  private journalEffort(
    resolution: IEffortResolution,
    blueprint: IAgentFileBlueprint,
    options: IAgentExecutionOptions,
    traceId: string,
    projection?: Opt<IProjectedCallOptions, Reason.OptionalContext>,
  ): void {
    const providerType = resolveProviderType(blueprint.provider);
    const payload = buildAgentEffortResolvedPayload({
      path: options.strategy ? "flow_step" : "execution",
      resolution,
      agentRole: options.agent_role,
      declared: {
        ...(this.options?.requestDeclaration?.effort !== undefined ||
            this.options?.requestDeclaration?.thinking !== undefined
          ? { request: this.options.requestDeclaration }
          : {}),
        ...(options.effort !== undefined || options.thinking !== undefined
          ? { flow_step: { effort: options.effort, thinking: options.thinking } }
          : {}),
        ...(blueprint.effort !== undefined || blueprint.thinking !== undefined
          ? { role: { effort: blueprint.effort, thinking: blueprint.thinking } }
          : {}),
      },
      providerType,
      model: blueprint.model,
      projection,
    });
    void this.logger.info(
      DomainEventType.AgentEffortResolved,
      options.agent_role ?? "",
      payload,
      traceId,
    );
  }
}
