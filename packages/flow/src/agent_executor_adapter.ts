/**
 * @module AgentOrchestratorAdapter
 * @path packages/flow/src/agent_executor_adapter.ts
 * @description Bridges IAgentRunner into FlowRunner's IAgentExecutor interface.
 * Loads blueprints by identityId and converts IFlowStepRequest to IParsedRequest
 * before delegating to IAgentRunner.run(). Also implements the strategy-routed seam
 * (Phase 159): `runWithStrategy` constructs a fresh, per-call `AgentOrchestrator` from
 * injected construction dependencies (never a stored, long-lived instance — see GAP-2)
 * and dispatches through the agent strategy registry with a forced strategy. Each call's
 * fresh orchestrator shares a `planWrittenFiles` Set with every other step of the SAME flow
 * run (keyed by trace_id, see `planWrittenFilesByTrace`), so a multi-step cli_delegate flow's
 * later steps don't revert an earlier step's still-uncommitted, legitimate writes (Step 8).
 * @architectural-layer Flows
 * @dependencies ["@exaix/execution", "@exaix/core"]
 * @related-files ["packages/flow/src/flow_runner.ts", "packages/execution/src/agent_runner.ts", "packages/execution/src/agent_orchestrator.ts"]
 */

import { AgentOrchestrator, type IAgentExecutionResult, type IBlueprint } from "@exaix/execution";
import type { StrategyRegistry } from "@exaix/execution";
import { IBlueprintLoader } from "@exaix/core/blueprint";
import type { IFlowStepRequest } from "./flow_runner.ts";
import type { IDatabaseService, JSONValue } from "@exaix/core";
import type { ExecutionStrategyName } from "@exaix/core";
import { ConfigValueType, SwapClass } from "@exaix/core";
import { configurable } from "@exaix/core/config";
import type { Opt, Reason } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import { PathResolver, type PortalPermissionsService } from "@exaix/portal";
import { OutputValidator, ToolRegistry } from "@exaix/tool-runtime";
import type { Config } from "@exaix/schemas/config.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { ModelResolver } from "@exaix/ai";
import type { IAgentExecutionOptionsInput, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";

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
  flowStepId?: string;
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
}

/**
 * Dependencies for constructing a fresh, per-call `AgentOrchestrator` — never a shared
 * instance, since it carries mutable state (`planWrittenFiles`) that must not survive past one call.
 */
export interface IAgentOrchestratorConstructionDeps {
  config: Config;
  db: IDatabaseService;
  logger: IEventLogger;
  permissions: PortalPermissionsService;
  provider?: IModelProvider;
  modelResolver?: ModelResolver;
  /**
   * Test-only escape hatch: inject a custom `StrategyRegistry` (e.g. spy strategies) to avoid
   * a live provider/subprocess; production never sets this, so the default registry applies.
   */
  strategyRegistry?: StrategyRegistry;
}

/** Bounds `planWrittenFiles` Map growth for this long-lived singleton (mirrors `apps/daemon/main.ts`'s `traceModelCache`). */
export const PLAN_WRITTEN_FILES_TRACE_MAX: number = configurable({
  key: "flow.plan_written_files_trace_max",
  default: 100,
  type: ConfigValueType.NUMBER,
  description:
    "Maximum number of distinct flow-run trace_ids whose planWrittenFiles accumulator AgentOrchestratorAdapter retains before evicting the least-recently-touched entry",
  min: 1,
  max: 10_000,
  swap: SwapClass.HOT,
});

/** Wraps an IAgentRunner (or compatible IRunner) into FlowRunner's IAgentExecutor interface. */
export class AgentOrchestratorAdapter {
  private loader: IBlueprintLoader;

  /** Files legitimately written by an earlier flow step, keyed by trace_id and shared across this run's AgentOrchestrator instances so a later step's audit doesn't revert them. */
  private readonly planWrittenFilesByTrace = new Map<string, Set<string>>();

  constructor(
    private runner: IRunner,
    blueprintsPath: string,
    private orchestratorDeps?: Opt<IAgentOrchestratorConstructionDeps, Reason.OptionalDependency>,
  ) {
    this.loader = new IBlueprintLoader({ blueprintsPath });
  }

  async hasBlueprint(identityId: string): Promise<boolean> {
    return await this.loader.exists(identityId);
  }

  async run(identityId: string, request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    const loaded = await this.loader.load(identityId);
    if (!loaded) {
      throw new Error(`Blueprint not found for identity: ${identityId}`);
    }
    const blueprint: IBlueprint = {
      systemPrompt: loaded.systemPrompt,
      identityId: loaded.identityId,
    };
    const parsedRequest: IParsedRequest = {
      userPrompt: request.userPrompt,
      context: (request.context ?? {}) as IRequestContextContext,
      requestId: request.requestId,
      traceId: request.traceId,
      scenarioId: request.scenarioId,
      stepId: request.stepId,
      flowStepId: request.flowStepId,
    };

    return await this.runner.run(blueprint, parsedRequest, undefined);
  }

  /** Strategy-routed step execution: builds a fresh per-call PathResolver/ToolRegistry/AgentOrchestrator (mirroring PlanExecutor.createAgentExecutor) and bridges the result into IAgentExecutionResult.content. */
  async runWithStrategy(
    identityId: string,
    request: IFlowStepRequest,
    strategy: ExecutionStrategyName.REACT | ExecutionStrategyName.MCP | ExecutionStrategyName.CLI_DELEGATE,
  ): Promise<IAgentExecutionResult> {
    if (!this.orchestratorDeps) {
      throw new Error(
        `runWithStrategy requires AgentOrchestrator construction dependencies, none were provided (identity: ${identityId}, strategy: ${strategy})`,
      );
    }
    if (!request.portal) {
      throw new Error(
        `runWithStrategy requires a portal on the flow step request — the flow was invoked with no portal (identity: ${identityId}, strategy: ${strategy})`,
      );
    }

    const { config, db, logger, permissions, provider, modelResolver, strategyRegistry } = this.orchestratorDeps;
    const portalConfig = config.portals?.find((p) => p.alias === request.portal);
    if (!portalConfig) {
      throw new Error(`runWithStrategy: portal not found in config: ${request.portal}`);
    }

    const traceId = request.traceId ?? crypto.randomUUID();
    const pathResolver = new PathResolver(config, { traceId });
    const toolRegistry = new ToolRegistry({ config, traceId, baseDir: portalConfig.target_path, pathResolver });
    // Bounded, least-recently-touched-evicted map: re-inserting a key moves it to the end of
    // the Map's iteration order, so an actively-touched trace is never the oldest entry and
    // is never evicted while its flow run is still in progress.
    let planWrittenFiles = this.planWrittenFilesByTrace.get(traceId);
    if (planWrittenFiles) {
      this.planWrittenFilesByTrace.delete(traceId);
    } else {
      if (this.planWrittenFilesByTrace.size >= PLAN_WRITTEN_FILES_TRACE_MAX) {
        const oldestTraceId = this.planWrittenFilesByTrace.keys().next().value;
        if (oldestTraceId) this.planWrittenFilesByTrace.delete(oldestTraceId);
      }
      planWrittenFiles = new Set<string>();
    }
    this.planWrittenFilesByTrace.set(traceId, planWrittenFiles);
    const orchestrator = new AgentOrchestrator({
      config,
      db,
      logger,
      pathResolver,
      permissions,
      provider,
      toolRegistry,
      modelResolver,
      strategyRegistry,
      planWrittenFiles,
    });

    try {
      const context: IExecutionContext = {
        trace_id: traceId,
        request_id: request.requestId ?? crypto.randomUUID(),
        request: request.userPrompt,
        // A flow step has no separate "plan" text distinct from its own built prompt —
        // reusing userPrompt for both avoids starving the strategy of task instructions.
        plan: request.userPrompt,
        portal: request.portal,
      };
      const options: IAgentExecutionOptionsInput = {
        identity_id: identityId,
        portal: request.portal,
        strategy,
      };
      const result = await orchestrator.executeStep(context, options);
      // A flow step's prompt requires wrapping the answer in <thought>/<content> tags. ReAct
      // already extracts the <content> body; CliDelegate returns raw unparsed text, so this
      // bridge calls parseXMLTags itself (a no-op for react's already-clean description).
      const { content } = new OutputValidator().parseXMLTags(result.description);
      return {
        thought: `Strategy-routed step completed via ${strategy}`,
        content,
        raw: JSON.stringify(result),
      };
    } finally {
      orchestrator.dispose();
    }
  }
}
