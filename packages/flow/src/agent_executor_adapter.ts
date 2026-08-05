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
 * Dependencies for constructing a fresh, per-call `AgentOrchestrator` inside
 * `runWithStrategy` — never a constructed `AgentOrchestrator` instance (GAP-2): the only
 * existing production construction pattern (`PlanExecutor.createAgentExecutor`) builds a
 * trace-scoped `PathResolver` and a portal-scoped `ToolRegistry` per execution, and
 * `AgentOrchestrator` carries instance-level mutable state (`planWrittenFiles`) that must
 * not survive past one call or it silently pre-authorizes a later, unrelated step's writes.
 */
export interface IAgentOrchestratorConstructionDeps {
  config: Config;
  db: IDatabaseService;
  logger: IEventLogger;
  permissions: PortalPermissionsService;
  provider?: IModelProvider;
  modelResolver?: ModelResolver;
  /**
   * Test-only escape hatch: inject a custom `StrategyRegistry` (e.g. spy strategies) to
   * avoid a live provider or subprocess in unit tests. Production wiring (Step 5) never
   * sets this, so `AgentOrchestrator`'s own default registry (real ReAct/MCP/CliDelegate)
   * applies there.
   */
  strategyRegistry?: StrategyRegistry;
}

/**
 * Adapter that wraps an IAgentRunner (or compatible IRunner) into FlowRunner's
 * IAgentExecutor interface. Loads blueprints by identityId and maps request types.
 */
export class AgentOrchestratorAdapter {
  private loader: IBlueprintLoader;

  /**
   * Files legitimately written by an earlier step of the SAME flow run, keyed by that run's
   * own `trace_id` — shared across the fresh, per-call `AgentOrchestrator` instances
   * `runWithStrategy` constructs for each of that flow's steps (Phase 159 Step 8 finding: a
   * later step's audit otherwise sees an empty Set and reverts an earlier step's still-
   * uncommitted, legitimate write). Keying by trace_id (not sharing one Set process-wide)
   * keeps different flow runs isolated, preserving GAP-2's guarantee. Grows for the lifetime
   * of this adapter instance (the daemon's own lifetime) — a bounded, per-flow-run set of
   * file paths, not cleaned up on flow completion; acceptable for now since each flow run
   * adds a handful of entries, not unboundedly many.
   */
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

  /**
   * Strategy-routed step execution (Phase 159). Builds a fresh, per-call
   * `PathResolver`/`ToolRegistry`/`AgentOrchestrator` (mirroring
   * `PlanExecutor.createAgentExecutor`), dispatches through the forced strategy, and
   * bridges the returned `IChangesetResult.description` into `IAgentExecutionResult.content`.
   */
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
    let planWrittenFiles = this.planWrittenFilesByTrace.get(traceId);
    if (!planWrittenFiles) {
      planWrittenFiles = new Set<string>();
      this.planWrittenFilesByTrace.set(traceId, planWrittenFiles);
    }
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
      // A flow step's prompt (flowStepOutputInstruction, flow_runner.ts) requires the model
      // to wrap its answer in <thought>/<content> tags, and for a final step, the <content>
      // body must parse as plan JSON downstream. ReActLoopStrategy already extracts just the
      // <content> body via its own OutputParser call before returning (createFinalResult);
      // CliDelegateStrategy does not (`description: parsed.lastText`, the model's raw,
      // unparsed text) — so bridging `result.description` unchanged fed the whole
      // thought+content text into plan-JSON parsing and got rejected ("Invalid JSON:
      // Unexpected token '<'", Phase 159 Step 8 live finding). Extracting here (not inside
      // CliDelegateStrategy) keeps the fix scoped to this bridge — react's already-clean
      // description has no <content> wrapper, so parseXMLTags' own no-tags-found fallback
      // returns it unchanged.
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
