/**
 * @module AgentComposerAdapter
 * @path packages/flow/src/agent_composer_adapter.ts
 * @description Bridges IAgentRunner into FlowRunner's IAgentExecutor interface.
 * Loads blueprints by agentRole and converts IFlowStepRequest to IParsedRequest
 * before delegating to IAgentRunner.run(). Also implements the strategy-routed seam
 * (Phase 159): `runWithStrategy` constructs a fresh, per-call `AgentComposer` from
 * injected construction dependencies (never a stored, long-lived instance — see GAP-2)
 * and dispatches through the agent strategy registry with a forced strategy. Each call's
 * fresh orchestrator shares a `planWrittenFiles` Set with every other step of the SAME flow
 * run and physical execution root, so a multi-step cli_delegate flow's
 * later steps don't revert an earlier step's still-uncommitted, legitimate writes (Step 8).
 * @architectural-layer Flows
 * @dependencies ["@exaix/execution", "@exaix/core"]
 * @related-files ["packages/flow/src/flow_runner.ts", "packages/execution/src/agent_runner.ts", "packages/execution/src/agent_composer.ts"]
 */

import { AgentComposer, type IAgentExecutionResult, type IBlueprint } from "@exaix/execution";
import type { StrategyRegistry } from "@exaix/execution";
import type { IRunCliDelegateProcess } from "@exaix/execution";
import { IBlueprintLoader } from "@exaix/core/blueprint";
import type { IFlowStepRequest } from "./flow_runner.ts";
import type { IDatabaseService, JSONValue } from "@exaix/core";
import { ConfigValueType, ExecutionStrategyName, SwapClass } from "@exaix/core";
import { configurable } from "@exaix/core/config";
import type {
  IApplicationContext,
  IDogfoodContextPort,
  IFlowWorktreeCoordinator,
  IRecordingLane,
  IRecordingLaneSource,
  Opt,
  Reason,
} from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import { PathResolver, type PortalPermissionsService } from "@exaix/portal";
import { OutputValidator, ToolRegistry } from "@exaix/tool-runtime";
import { resolveWorktreeBaseDir } from "./resolve_worktree_base_dir.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import {
  BOUND_TARGET_KIND_PROVIDER,
  BOUND_TARGET_KIND_SESSION_TOOL,
  type IEffortResolver,
  type ModelBindingService,
  type ModelResolver,
  STEP_KIND_AGENT,
} from "@exaix/ai";
import {
  COMPLEXITY_SOURCE_ANALYSIS,
  COMPLEXITY_SOURCE_DEFAULT,
  RecordingLaneProvider,
  taskComplexityFromAnalysis,
} from "@exaix/ai";
import { strategyLane } from "./contracts/flow_recording_context.ts";
import { buildSharedNamespacePrompt } from "./shared_namespace_prompt.ts";
import { FlowWriteAuthorization, type IFlowWriteAuthorization } from "./flow_write_authorization.ts";
import type { EffortDeclaration, IFixedModelClient, SessionTool, ThinkingDeclaration } from "@exaix/schemas";
import type { TaskComplexity } from "@exaix/core";
import type { IAgentExecutionOptionsInput, IExecutionContext } from "@exaix/schemas/agent_composer.ts";

/**
 * Minimal request context type for converting IFlowStepRequest to IParsedRequest.
 */
interface IRequestContextContext {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | IRequestContextContext
    | (string | number | boolean | null | undefined | IRequestContextContext)[]
    | string[];
}

interface IParsedRequest {
  userPrompt: string;
  context: IRequestContextContext;
  requestId?: string;
  traceId?: string;
  scenarioId?: string;
  stepId?: string;
  portal?: string;
  flowId?: string;
  flowStepId?: string;
  flowOutputKind?: "branch-json";
  recordingLane?: IRecordingLane;
  flowStepEffort?: EffortDeclaration;
  flowStepThinking?: ThinkingDeclaration;
  bindingEffort?: EffortDeclaration;
  bindingThinking?: ThinkingDeclaration;
  taskComplexity?: TaskComplexity;
  taskComplexitySource?: string;
}

/**
 * Minimal runner interface matching the subset of IAgentRunner used by the adapter.
 */
export interface IRunner {
  run(
    blueprint: IBlueprint,
    request: IParsedRequest,
    jsonSchema?: Record<string, JSONValue>,
  ): Promise<IAgentExecutionResult>;
  withProvider?(provider: IModelProvider, selectedModel: { provider: string; model: string }): IRunner;
}

/** For constructing a fresh, per-call `AgentComposer` — never a shared instance, since
 *  it carries mutable state (`planWrittenFiles`) that must not survive past one call. */
export interface IAgentComposerConstructionDeps {
  config: Config;
  db: IDatabaseService;
  logger: IEventLogger;
  permissions: PortalPermissionsService;
  provider?: IModelProvider;
  modelResolver?: ModelResolver;
  applicationContext?: IApplicationContext;
  /** Test-only escape hatch: inject a custom `StrategyRegistry` (e.g. spy strategies) to
   *  avoid a live provider/subprocess; production never sets this. */
  strategyRegistry?: StrategyRegistry;
  /** Optional dogfood bounded-context port passed through to AgentComposer's
   *  CliDelegateStrategy; absent for every non-dogfood/disabled-config caller. */
  contextPort?: Opt<IDogfoodContextPort, Reason.OptionalDependency>;
  /** Agent-role blueprint IDs trusted to activate contextPort, passed through to
   *  AgentComposer. Mandatory whenever contextPort is set. */
  trustedAgentRoles?: Opt<ReadonlySet<string>, Reason.OptionalDependency>;
  /** Optional per-trace worktree resolver. Its absence preserves each portal's configured target path. */
  worktreeCoordinator?: Opt<IFlowWorktreeCoordinator, Reason.OptionalDependency>;
  /** The EffortResolver instance forwarded into AgentComposer's execution resolution so
   *  the flow path shares the planning path's injected instance (GAP-9). */
  effortResolver?: IEffortResolver;
  /** Bind a strategy cli_delegate step to a specific session tool and model (Step 3).
   *  The tool must be a cli-delegate catalog service.
   *  AgentComposer prefers it over `config.cli_delegate`, and it stays active
   *  even when that config flag is disabled. */
  cliDelegateBinding?: { tool: SessionTool; model: string };
  /** Test-only escape hatch, a fake subprocess runner for the cli-delegate strategy.
   *  Production never sets this flag. */
  cliDelegateRun?: IRunCliDelegateProcess;
  /** The provider type and model of `provider`. An unbound step runs on it, so model
   *  resolution reports it. */
  fixedClient?: IFixedModelClient;
}

/** Bounds `planWrittenFiles` Map growth for this long-lived singleton (mirrors `apps/daemon/main.ts`'s `traceModelCache`). */
export const PLAN_WRITTEN_FILES_TRACE_MAX: number = configurable({
  key: "flow.plan_written_files_trace_max",
  default: 100,
  type: ConfigValueType.NUMBER,
  description:
    "Maximum number of distinct flow-run trace_ids whose planWrittenFiles accumulator AgentComposerAdapter retains before evicting the least-recently-touched entry",
  min: 1,
  max: 10_000,
  swap: SwapClass.HOT,
});

/** Wraps non-JSON strategy output as a minimal valid Plan for `PlanAdapter.parse` — its
 *  cross-field refine requires `steps` (or a specialized field), not `description` alone. */
function ensurePlanJson(content: string): string {
  try {
    JSON.parse(content);
    return content;
  } catch {
    return JSON.stringify({
      description: content,
      steps: [{ step: 1, title: "Review", description: content }],
    });
  }
}

/** Keys each strategy turn by the run lane when the run opted into recording lanes. */
function withRecordingLane(
  provider: Opt<IModelProvider, Reason.OptionalDependency>,
  lane: Opt<IRecordingLane, Reason.OptionalContext>,
): Opt<IModelProvider, Reason.OptionalDependency> {
  return provider && lane ? new RecordingLaneProvider(provider, lane) : provider;
}

/** Wraps an IAgentRunner (or compatible IRunner) into FlowRunner's IAgentExecutor interface. */
export class AgentComposerAdapter {
  private loader: IBlueprintLoader;

  private readonly writeAuthorization: IFlowWriteAuthorization = new FlowWriteAuthorization(
    PLAN_WRITTEN_FILES_TRACE_MAX,
  );

  constructor(
    private runner: IRunner,
    blueprintsPath: string,
    private orchestratorDeps?: Opt<IAgentComposerConstructionDeps, Reason.OptionalDependency>,
    private bindingService?: Opt<ModelBindingService, Reason.OptionalDependency>,
  ) {
    this.loader = new IBlueprintLoader({ blueprintsPath });
  }

  /** The fixture lane a provider-backed strategy step records its turns on. A CLI delegate is protocol-fixtured. */
  static strategyRecordingLane(
    recording: Opt<IRecordingLaneSource, Reason.OptionalContext>,
    flowStepId: Opt<string, Reason.OptionalContext>,
    strategy: string,
  ): IRecordingLane | undefined {
    if (!recording || !flowStepId || strategy === ExecutionStrategyName.CLI_DELEGATE) return undefined;
    return recording.lane(strategyLane(flowStepId, strategy));
  }

  async hasBlueprint(agentRole: string): Promise<boolean> {
    return await this.loader.exists(agentRole);
  }

  /** Carry reconciled, reviewed cycle writes into this flow's later strategy audits. */
  async recordReviewedWrites(
    traceId: string,
    executionRoot: string,
    paths: readonly string[],
    portalAlias: string,
  ): Promise<void> {
    if (!this.orchestratorDeps) throw new Error("Reviewed writes require AgentComposer construction dependencies");
    const { config, worktreeCoordinator } = this.orchestratorDeps;
    const portal = config.portals.find((entry) => entry.alias === portalAlias);
    if (!portal || await Deno.realPath(portal.target_path) !== await Deno.realPath(executionRoot)) {
      throw new Error("Reviewed writes do not match the configured portal root");
    }
    const root = await resolveWorktreeBaseDir(portal, traceId, worktreeCoordinator);
    const resolver = new PathResolver({ ...config, portals: [{ ...portal, target_path: root }] });
    await this.writeAuthorization.record(traceId, root, paths, (path) => resolver.resolve(`@${portalAlias}/${path}`));
  }

  async run(agentRole: string, request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    const loaded = await this.loader.load(agentRole);
    if (!loaded) {
      throw new Error(`Blueprint not found for agent_role: ${agentRole}`);
    }
    // GAP-4 fix: use the loader's legacy projection so the flow role's declared
    // effort/thinking/default_skills reach AgentRunner instead of being dropped.
    const blueprint: IBlueprint = this.loader.toLegacyBlueprint(loaded);
    const analysis = request.requestAnalysis;
    const parsedRequest: IParsedRequest = {
      userPrompt: buildSharedNamespacePrompt(request.userPrompt, request.sharedNamespace),
      context: (request.context ?? {}) as IRequestContextContext,
      requestId: request.requestId,
      traceId: request.traceId,
      scenarioId: request.scenarioId,
      stepId: request.stepId,
      portal: request.portal,
      flowId: request.flowId,
      flowStepId: request.flowStepId,
      flowOutputKind: request.flowOutputKind,
      recordingLane: request.flowStepId
        ? request.recording?.lane(request.recordingLaneId ?? request.flowStepId)
        : undefined,
      flowStepEffort: request.effort,
      flowStepThinking: request.thinking,
      taskComplexity: taskComplexityFromAnalysis(analysis?.complexity),
      taskComplexitySource: analysis ? COMPLEXITY_SOURCE_ANALYSIS : COMPLEXITY_SOURCE_DEFAULT,
    };

    if (this.bindingService && request.bindingSnapshot && request.flowId && request.flowStepId) {
      const bound = await this.bindingService.providerFor(request.bindingSnapshot, {
        flowId: request.flowId,
        stepId: request.flowStepId,
        agentRole,
        kind: STEP_KIND_AGENT,
        nativeTools: false,
      });
      if (bound) {
        if (bound.kind !== BOUND_TARGET_KIND_PROVIDER) {
          throw new Error(
            `Session-tool service ${bound.binding.service} is not valid on a DECLARED step without strategy cli_delegate`,
          );
        }
        if (!this.runner.withProvider) throw new Error("Bound runner does not support provider replacement");
        parsedRequest.bindingEffort = bound.binding.effort;
        parsedRequest.bindingThinking = bound.binding.thinking;
        return await this.runner.withProvider(bound.provider, {
          provider: bound.binding.adapter,
          model: bound.binding.service_model_id,
        }).run(blueprint, parsedRequest, undefined);
      }
    }
    return await this.runner.run(blueprint, parsedRequest, undefined);
  }

  /** Strategy-routed step execution: builds a fresh per-call PathResolver/ToolRegistry/AgentComposer (mirroring PlanExecutor.createAgentExecutor) and bridges the result into IAgentExecutionResult.content. */
  async runWithStrategy(
    agentRole: string,
    request: IFlowStepRequest,
    strategy: ExecutionStrategyName.REACT | ExecutionStrategyName.MCP | ExecutionStrategyName.CLI_DELEGATE,
  ): Promise<IAgentExecutionResult> {
    if (!this.orchestratorDeps) {
      throw new Error(
        `runWithStrategy requires AgentComposer construction dependencies, none were provided (agent_role: ${agentRole}, strategy: ${strategy})`,
      );
    }
    if (!request.portal) {
      throw new Error(
        `runWithStrategy requires a portal on the flow step request — the flow was invoked with no portal (agent_role: ${agentRole}, strategy: ${strategy})`,
      );
    }

    const {
      config,
      db,
      logger,
      permissions,
      provider,
      modelResolver,
      applicationContext,
      strategyRegistry,
      contextPort,
      trustedAgentRoles,
      effortResolver,
    } = this.orchestratorDeps;
    const portalConfig = config.portals?.find((p) => p.alias === request.portal);
    if (!portalConfig) {
      throw new Error(`runWithStrategy: portal not found in config: ${request.portal}`);
    }

    // A bound strategy step runs on the bound provider.
    // A bound cli-delegate tool launches on strategy cli_delegate.
    // Never resolved after the run snapshot, so an unbound step keeps the boot provider.
    const boundResolution = await this.resolveStrategyBinding(agentRole, request, strategy, provider);
    const recordingLane = AgentComposerAdapter.strategyRecordingLane(request.recording, request.flowStepId, strategy);

    const traceId = request.traceId ?? crypto.randomUUID();
    const pathResolver = new PathResolver(config, { traceId });
    const baseDir = await resolveWorktreeBaseDir(portalConfig, traceId, this.orchestratorDeps.worktreeCoordinator);
    const toolRegistry = new ToolRegistry({
      config,
      traceId,
      baseDir,
      pathResolver,
      context: applicationContext,
    });
    const planWrittenFiles = await this.writeAuthorization.get(traceId, baseDir);
    const orchestrator = new AgentComposer({
      config,
      db,
      logger,
      pathResolver,
      permissions,
      provider: withRecordingLane(boundResolution.effectiveProvider, recordingLane),
      toolRegistry,
      modelResolver,
      strategyRegistry,
      planWrittenFiles,
      contextPort,
      trustedAgentRoles,
      effortResolver,
      ...(boundResolution.cliDelegateBinding ? { cliDelegateBinding: boundResolution.cliDelegateBinding } : {}),
      ...(this.orchestratorDeps.cliDelegateRun ? { cliDelegateRun: this.orchestratorDeps.cliDelegateRun } : {}),
      ...(boundResolution.fixedClient ? { options: { fixedClient: boundResolution.fixedClient } } : {}),
    });

    try {
      const userPrompt = buildSharedNamespacePrompt(request.userPrompt, request.sharedNamespace);
      const context: IExecutionContext = {
        trace_id: traceId,
        request_id: request.requestId ?? crypto.randomUUID(),
        request: userPrompt,
        // A flow step has no separate "plan" text distinct from its own built prompt —
        // reusing userPrompt for both avoids starving the strategy of task instructions.
        plan: userPrompt,
        portal: request.portal,
      };
      const options: IAgentExecutionOptionsInput = {
        agent_role: agentRole,
        portal: request.portal,
        strategy,
        ...(boundResolution.boundEffort !== undefined
          ? { effort: boundResolution.boundEffort }
          : request.effort !== undefined
          ? { effort: request.effort }
          : {}),
        ...(boundResolution.boundThinking !== undefined
          ? { thinking: boundResolution.boundThinking }
          : request.thinking !== undefined
          ? { thinking: request.thinking }
          : {}),
      };
      const result = await orchestrator.executeStep(context, options);
      // A flow step's prompt requires wrapping the answer in <thought>/<content> tags. ReAct
      // already extracts the <content> body; CliDelegate returns raw unparsed text, so this
      // bridge calls parseXMLTags itself (a no-op for react's already-clean description).
      const { content } = new OutputValidator().parseXMLTags(result.description);
      return {
        thought: `Strategy-routed step completed via ${strategy}`,
        content: request.expectPlanJsonOutput ? ensurePlanJson(content) : content,
        raw: JSON.stringify(result),
      };
    } finally {
      orchestrator.dispose();
    }
  }

  /** The strategy step's bound target: the bound provider, the bound cli-delegate tool, or
   *  the boot provider when unbound (Step-3). Never re-resolves after the run snapshot. */
  private async resolveStrategyBinding(
    agentRole: string,
    request: IFlowStepRequest,
    strategy: ExecutionStrategyName.REACT | ExecutionStrategyName.MCP | ExecutionStrategyName.CLI_DELEGATE,
    provider: Opt<IModelProvider, Reason.OptionalDependency>,
  ): Promise<{
    effectiveProvider: Opt<IModelProvider, Reason.OptionalDependency>;
    cliDelegateBinding?: { tool: SessionTool; model: string };
    boundEffort?: EffortDeclaration;
    boundThinking?: ThinkingDeclaration;
    fixedClient?: IFixedModelClient;
  }> {
    // A cli_delegate step runs its session tool, not the boot provider.
    const bootClient = strategy === ExecutionStrategyName.CLI_DELEGATE ? undefined : this.orchestratorDeps?.fixedClient;
    const unbound = { effectiveProvider: provider, ...(bootClient ? { fixedClient: bootClient } : {}) };
    if (!this.bindingService || !request.bindingSnapshot || !request.flowId || !request.flowStepId) return unbound;
    const bound = await this.bindingService.providerFor(request.bindingSnapshot, {
      flowId: request.flowId,
      stepId: request.flowStepId,
      agentRole,
      kind: STEP_KIND_AGENT,
      strategy,
      nativeTools: false,
    });
    if (!bound) return unbound;
    if (strategy === ExecutionStrategyName.CLI_DELEGATE) {
      if (bound.kind !== BOUND_TARGET_KIND_SESSION_TOOL) {
        throw new Error(
          `Strategy cli_delegate requires a cli-delegate service; ${bound.binding.service} is not one`,
        );
      }
      return {
        effectiveProvider: provider,
        cliDelegateBinding: { tool: bound.tool, model: bound.binding.service_model_id },
        boundEffort: bound.binding.effort,
        boundThinking: bound.binding.thinking,
      };
    }
    if (bound.kind !== BOUND_TARGET_KIND_PROVIDER) {
      throw new Error(
        `Service ${bound.binding.service} is a session-tool delegate; strategy ${strategy} cannot run it`,
      );
    }
    return {
      effectiveProvider: bound.provider,
      boundEffort: bound.binding.effort,
      boundThinking: bound.binding.thinking,
      fixedClient: { provider: bound.binding.adapter, model: bound.binding.service_model_id },
    };
  }
}
