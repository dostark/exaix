/**
 * @module AgentRunnerEffort
 * @path packages/execution/src/agent_runner_effort.ts
 * @description Resolves declaration-time effort and thinking for one agent run and journals the resolution.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_runner.ts, packages/execution/src/effort_resolution_payload.ts]
 */

import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IBlueprint } from "@exaix/core/blueprint";
import { COMPLEXITY_SOURCE_DEFAULT, ProviderRegistry, readProviderModelInfo, resolveProviderType } from "@exaix/ai";
import type { IEffortResolution, IEffortResolutionSignals, IEffortResolver } from "@exaix/ai";
import { buildAgentEffortResolvedPayload } from "./effort_resolution_payload.ts";
import type { IProjectedCallOptions } from "@exaix/ai";
import type { EffortTier } from "@exaix/schemas";
import type { JSONValue } from "@exaix/core";
import { TaskComplexity } from "@exaix/core";
import type { ProviderType } from "@exaix/core";
import type { IApplicationContext } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import type { Opt, Reason } from "@exaix/core/types";
import type { IParsedRequest } from "./agent_runner.ts";

export interface ISelectedModelIdentity {
  provider: string;
  model: string;
  /** Canonical provider type. The resolver derives it from the provider when absent. */
  providerType?: ProviderType;
}

/** What the effort steps of one runner need from it. */
interface IAgentRunnerEffortDependencies {
  readonly effortResolver: IEffortResolver;
  readonly modelProvider: IModelProvider;
  readonly config: Opt<{ readonly context?: IApplicationContext }, Reason.OptionalDependency>;
  /** The provider and model that the run is bound to, read on each call. */
  readonly selectedModel: () => ISelectedModelIdentity;
  readonly journal: (
    action: string,
    target: string | null,
    payload: Record<string, JSONValue>,
    traceId: Opt<string, Reason.TraceAbsent>,
    agentRole: string,
  ) => void;
}

/** Declaration-time effort and thinking resolution for one agent runner, with its journal row. */
export class AgentRunnerEffort {
  private readonly effortResolver: IEffortResolver;
  private readonly modelProvider: IModelProvider;
  private readonly config: IAgentRunnerEffortDependencies["config"];
  private readonly selectedModel: IAgentRunnerEffortDependencies["selectedModel"];
  private readonly journal: IAgentRunnerEffortDependencies["journal"];

  constructor(dependencies: IAgentRunnerEffortDependencies) {
    this.effortResolver = dependencies.effortResolver;
    this.modelProvider = dependencies.modelProvider;
    this.config = dependencies.config;
    this.selectedModel = dependencies.selectedModel;
    this.journal = dependencies.journal;
  }

  async resolve(
    blueprint: IBlueprint,
    request: IParsedRequest,
    agentRole: string,
    skillFloors: ReadonlyArray<{ skillId: string; effort?: EffortTier; thinking?: boolean }>,
  ): Promise<IEffortResolution> {
    const selectedModel = this.selectedModel();
    const providerType = selectedModel.providerType ?? resolveProviderType(selectedModel.provider);
    const providerMetadata = providerType !== undefined
      ? ProviderRegistry.getProviderMetadata(providerType)
      : undefined;
    const modelInfo = await readProviderModelInfo(providerMetadata, selectedModel.model);
    const signals: IEffortResolutionSignals = {
      taskComplexity: request.taskComplexity ?? TaskComplexity.MEDIUM,
      complexitySource: request.taskComplexitySource ?? COMPLEXITY_SOURCE_DEFAULT,
      modelSize: blueprint.modelSize,
      providerType,
      model: selectedModel.model,
      providerSupportsThinking: modelInfo?.supportsThinking ?? this.modelProvider.callCapabilities?.supportsThinking ??
        providerMetadata?.supportsThinking === true,
      anthropicThinkingDefault: this.config?.context?.config.get().ai_anthropic?.thinking_default,
      skillFloors,
      agentRole,
    };
    return this.effortResolver.resolve(
      {
        binding: { effort: request.bindingEffort, thinking: request.bindingThinking },
        role: { effort: blueprint.effort, thinking: blueprint.thinking },
        request: { effort: request.effort, thinking: request.thinking },
        flowStep: { effort: request.flowStepEffort, thinking: request.flowStepThinking },
      },
      signals,
    );
  }

  /** Resolves declaration-time effort and thinking through EffortResolver, using the selected model's provider
   *  and the request's TaskComplexity. Journals the result as agent.effort_resolved, joinable by traceId.
   *  buildAgentEffortResolvedPayload owns the payload shape. */
  journalResolution(
    blueprint: IBlueprint,
    request: IParsedRequest,
    agentRole: string,
    resolution: IEffortResolution,
    correlation: { traceId?: string; requestId?: string },
    projection?: Opt<IProjectedCallOptions, Reason.OptionalContext>,
  ): void {
    const { traceId, requestId } = correlation;
    const selectedModelId = this.selectedModel();
    const payload = buildAgentEffortResolvedPayload({
      path: request.flowStepId ? "flow_step" : "planning",
      resolution,
      agentRole,
      declared: {
        ...(request.effort !== undefined || request.thinking !== undefined
          ? { request: { effort: request.effort, thinking: request.thinking } }
          : {}),
        ...(request.flowStepEffort !== undefined || request.flowStepThinking !== undefined
          ? { flow_step: { effort: request.flowStepEffort, thinking: request.flowStepThinking } }
          : {}),
        ...(blueprint.effort !== undefined || blueprint.thinking !== undefined
          ? { role: { effort: blueprint.effort, thinking: blueprint.thinking } }
          : {}),
      },
      providerType: selectedModelId.providerType,
      model: selectedModelId.model,
      projection,
    });
    this.journal(DomainEventType.AgentEffortResolved, requestId ?? null, payload, traceId, agentRole);
  }
}
