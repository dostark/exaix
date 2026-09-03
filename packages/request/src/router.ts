/**
 * @module RequestRouter
 * @path packages/request/src/router.ts
 * @description Determines whether to route a request to FlowRunner or IAgentRunner
 * based on the request schema (flow vs agent fields).
 *
 * Provides a unified entry point for request processing, enabling seamless
 * transition between orchestrated flows and individual agent executions.
 *
 * @architectural-layer Services
 * @related-files [packages/request/src/processor.ts]
 */

import type { IAgentExecutionResult, IAgentRunner, IBlueprint, IParsedRequest } from "@exaix/execution";
import type { IEventLogger } from "@exaix/core/logger";
import { IBlueprintLoader } from "@exaix/core/blueprint";
import { type IWorkspaceExecutionContext, WorkspaceExecutionContextBuilder } from "@exaix/portal";
import type { Config, IPortalConfig } from "@exaix/schemas/config.ts";
import { PORTAL_CONTEXT_KEY, RequestKind } from "@exaix/core";
import { buildPortalContextBlock } from "@exaix/core/func";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { IRequestFrontmatter } from "@exaix/core/request";
import type { IFlow } from "@exaix/schemas/flow.ts";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import type { IApplicationContext } from "@exaix/core/types";
import type { IRoutingPolicyDecision } from "@exaix/schemas/routing_policy.ts";
import type { IRoutingPolicyService } from "@exaix/routing";
import { GitBranchName } from "@exaix/git";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { normalizeFrontmatterList } from "./common.ts";

export interface IFlowResult {
  flowRunId: string;
  success: boolean;
  stepResults: Map<string, unknown>;
  output: string;
  duration: number;
  startedAt: Date;
  completedAt: Date;
  namespaceArtifactPath?: string;
  tokenSummary?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    token_provider?: string;
    token_model?: string;
    token_cost_usd?: number;
  };
}

export interface IFlowRunnerRequest {
  userPrompt: string;
  traceId?: string;
  requestId?: string;
  requestAnalysis?: IRequestAnalysis;
  portalKnowledge?: IPortalKnowledge;
  portal?: string;
}

export interface IFlowRunner {
  execute(
    flow: IFlow,
    request: IFlowRunnerRequest,
  ): Promise<IFlowResult>;
}

export interface IRoutingDecision {
  type: RequestKind;
  flowId?: string;
  agentRole?: string;
  result: IAgentExecutionResult | IFlowResult;
}

/** Typed request shape used by the router's internal methods */
interface RouterRequest {
  traceId: string;
  requestId: string;
  frontmatter: IRequestFrontmatter;
  body: string;
  requestAnalysis?: IRequestAnalysis;
}

type RouterRequestFrontmatterMap = IRequestFrontmatter & {
  [key: string]: JSONValue;
};

export interface IFlowValidator {
  validateFlow(flowId: string): Promise<{ valid: boolean; error?: string }>;
}

export interface IRequestRouterConfig {
  flowRunner: IFlowRunner;
  agentRunner: IAgentRunner;
  flowValidator: IFlowValidator;
  eventLogger: IEventLogger;
  defaultAgentId: string;
  blueprintsPath: string;
  config: Config;
  routingPolicyService?: IRoutingPolicyService;
  context?: IApplicationContext;
}

function normalizeText(value?: Opt<string, Reason.SensibleDefault>): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export class RoutingError extends Error {
  constructor(message: string, public readonly requestId?: Opt<string, Reason.OptionalInput>) {
    super(message);
    this.name = "RoutingError";
  }
}

/**
 * RequestRouter handles routing decisions for incoming requests
 */
export class RequestRouter {
  private flowRunner: IFlowRunner;
  private agentRunner: IAgentRunner;
  private flowValidator: IFlowValidator;
  private eventLogger: IEventLogger;
  private defaultAgentId: string;
  private blueprintsPath: string;
  private config: Config;
  private routingPolicyService?: IRoutingPolicyService;

  constructor(options: IRequestRouterConfig) {
    const ctx = options.context;
    this.flowRunner = options.flowRunner;
    this.agentRunner = options.agentRunner;
    this.flowValidator = options.flowValidator;
    this.eventLogger = options.eventLogger;
    this.defaultAgentId = options.defaultAgentId;
    this.blueprintsPath = options.blueprintsPath;
    this.config = ctx?.config.get() || options.config;
    this.routingPolicyService = options.routingPolicyService;
  }

  /**
   * Build execution context based on request portal parameter
   */
  buildExecutionContext(request: {
    frontmatter: IRequestFrontmatter;
  }): IWorkspaceExecutionContext {
    const portalAlias = request.frontmatter.portal;

    // If portal specified, create portal context
    if (portalAlias) {
      // Find portal in config
      const portal = this.config.portals.find((p) => p.alias === portalAlias);

      if (!portal) {
        throw new Error(`Portal '${portalAlias}' not found`);
      }

      const portalPermissions: IPortalConfig = {
        alias: portal.alias,
        target_path: portal.target_path,
        default_branch: portal.default_branch ?? GitBranchName.MAIN,
        agents_allowed: portal.agents_allowed ?? ["*"],
        operations: portal.operations ?? [],
        created: portal.created,
      };

      return WorkspaceExecutionContextBuilder.forPortal(portalPermissions);
    }

    // Otherwise, create workspace context
    return WorkspaceExecutionContextBuilder.forWorkspace(
      this.config.system.root,
    );
  }

  /**
   * Route a request to the appropriate execution engine
   */
  async route(request: RouterRequest): Promise<IRoutingDecision> {
    const { traceId, requestId, frontmatter } = request;
    const flowId = frontmatter.flow;
    const agentRole = frontmatter.agent_role;

    // Check for conflicting fields
    if (flowId && agentRole) {
      await this.eventLogger.log({
        action: "request.routing.error",
        target: requestId,
        payload: {
          error: "Request cannot specify both 'flow' and 'agent_role' fields",
          field: "conflict",
          value: `${flowId}/${agentRole}`,
        },
        traceId,
      });
      throw new RoutingError(
        "Request cannot specify both 'flow' and 'agent_role' fields",
        requestId,
      );
    }

    // Route to flow if specified
    if (flowId) {
      return await this.routeToFlow(flowId, request);
    }

    // Route to agent if specified
    if (agentRole) {
      return await this.routeToAgent(agentRole, request);
    }

    // Route to default agent
    return await this.routeToDefaultAgent(request);
  }

  public async routeToFlow(flowId: string, request: RouterRequest): Promise<IRoutingDecision> {
    const { traceId, requestId } = request;

    // Log routing decision
    await this.eventLogger.log({
      action: "request.routing.flow",
      target: requestId,
      payload: { flowId },
      traceId,
    });

    // Validate flow
    const validation = await this.flowValidator.validateFlow(flowId);
    if (!validation.valid) {
      await this.eventLogger.log({
        action: "request.flow.validation.failed",
        target: flowId,
        payload: { error: validation.error ?? null },
        traceId,
      });
      throw new RoutingError(validation.error!, requestId);
    }

    // Log successful validation
    await this.eventLogger.log({
      action: "request.flow.validated",
      target: flowId,
      payload: {},
      traceId,
    });

    // Execute flow
    const result = await this.flowRunner.execute(
      { id: flowId } as IFlow, // Flow object will be loaded by FlowRunner
      {
        userPrompt: request.body,
        traceId,
        requestId,
        portal: request.frontmatter?.portal,
      },
    );

    return {
      type: RequestKind.FLOW,
      flowId,
      result,
    };
  }

  public async routeToAgent(agentRole: string, request: RouterRequest): Promise<IRoutingDecision> {
    const { traceId, requestId } = request;

    // Log routing decision
    await this.eventLogger.log({
      action: "request.routing.agent_role",
      target: requestId,
      payload: { agentRole },
      traceId,
    });

    const { selectedAgentRole, policyDecision } = await this.selectAgentRole(request, agentRole);

    if (policyDecision) {
      await this.logRoutingDecision(requestId, traceId, {
        explicit_agent_role: agentRole,
      }, policyDecision);

      if (policyDecision.strategy === "capability_fallback" || policyDecision.strategy === "static_fallback") {
        await this.eventLogger.log({
          action: "routing.fallback_used",
          target: requestId,
          payload: {
            fallback_agent_role: selectedAgentRole,
            strategy: policyDecision.strategy,
            reason: "Routing policy returned a fallback candidate",
          },
          traceId,
        });
      }

      if (policyDecision.experimentApplied) {
        await this.eventLogger.log({
          action: "routing.experiment_applied",
          target: requestId,
          payload: {
            selected_agent_role: policyDecision.selectedAgentRole,
            selected_version: policyDecision.selectedVersion,
            strategy: policyDecision.strategy,
            matched_rule_id: policyDecision.matchedRuleId ?? null,
            experiment_bucket: policyDecision.experimentBucket ?? null,
          },
          traceId,
        });
      }
    }

    // Load blueprint
    const blueprint = await this.loadBlueprint(selectedAgentRole);
    if (!blueprint) {
      throw new RoutingError(`Agent blueprint not found: ${selectedAgentRole}`, requestId);
    }

    // Create parsed request
    const parsedRequest = this.createParsedRequest(request, Boolean(policyDecision));

    // Execute agent
    const result = await this.agentRunner.run(blueprint, parsedRequest);

    return {
      type: RequestKind.IDENTITY,
      agentRole: selectedAgentRole,
      result,
    };
  }

  public async routeToDefaultAgent(request: RouterRequest): Promise<IRoutingDecision> {
    const { traceId, requestId } = request;

    // Log routing decision
    await this.eventLogger.log({
      action: "request.routing.default",
      target: requestId,
      payload: { defaultAgentId: this.defaultAgentId },
      traceId,
    });

    const { selectedAgentRole, policyDecision } = await this.selectAgentRole(request, undefined);

    if (policyDecision) {
      await this.logRoutingDecision(requestId, traceId, {
        default_agent_id: this.defaultAgentId,
      }, policyDecision);

      if (policyDecision.strategy === "capability_fallback" || policyDecision.strategy === "static_fallback") {
        await this.eventLogger.log({
          action: "routing.fallback_used",
          target: requestId,
          payload: {
            fallback_agent_role: selectedAgentRole,
            strategy: policyDecision.strategy,
            reason: "Routing policy returned a fallback candidate",
          },
          traceId,
        });
      }

      if (policyDecision.experimentApplied) {
        await this.eventLogger.log({
          action: "routing.experiment_applied",
          target: requestId,
          payload: {
            selected_agent_role: policyDecision.selectedAgentRole,
            selected_version: policyDecision.selectedVersion,
            strategy: policyDecision.strategy,
            matched_rule_id: policyDecision.matchedRuleId ?? null,
            experiment_bucket: policyDecision.experimentBucket ?? null,
          },
          traceId,
        });
      }
    }

    // Load selected blueprint
    const blueprint = await this.loadBlueprint(selectedAgentRole);
    if (!blueprint) {
      throw new RoutingError(`Agent blueprint not found: ${selectedAgentRole}`, requestId);
    }

    // Create parsed request
    const parsedRequest = this.createParsedRequest(request, Boolean(policyDecision));

    // Execute default agent
    const result = await this.agentRunner.run(blueprint, parsedRequest);

    return {
      type: RequestKind.IDENTITY,
      agentRole: selectedAgentRole,
      result,
    };
  }

  protected async loadBlueprint(agentRole: string): Promise<IBlueprint | null> {
    const loader = new IBlueprintLoader({ blueprintsPath: this.blueprintsPath });
    const loaded = await loader.load(agentRole);
    if (!loaded) {
      return null;
    }
    return loader.toLegacyBlueprint(loaded);
  }

  private buildRoutingContext(request: RouterRequest): {
    matchCriteria: {
      capability?: string;
      complexityMin?: number;
      complexityMax?: number;
      language?: string;
      taskType?: string;
      portalType?: string;
      tags: string[];
    };
    requestText?: string;
    requestAnalysis?: IRequestAnalysis;
    portalName?: string;
    flowStepId?: string;
  } {
    const frontmatter = request.frontmatter as RouterRequestFrontmatterMap;
    const tags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags.map((tag) => String(tag).trim()).filter((tag) => tag.length > 0)
      : typeof frontmatter.tags === "string"
      ? [frontmatter.tags.trim()]
      : [];

    return {
      requestText: normalizeText(request.body),
      requestAnalysis: request.requestAnalysis,
      portalName: normalizeText(typeof frontmatter.portal === "string" ? frontmatter.portal : undefined),
      flowStepId: normalizeText(typeof frontmatter.flow_step_id === "string" ? frontmatter.flow_step_id : undefined),
      matchCriteria: {
        capability: normalizeText(typeof frontmatter.capability === "string" ? frontmatter.capability : undefined),
        complexityMin: typeof frontmatter.complexity_min === "number" ? frontmatter.complexity_min : undefined,
        complexityMax: typeof frontmatter.complexity_max === "number" ? frontmatter.complexity_max : undefined,
        language: normalizeText(typeof frontmatter.language === "string" ? frontmatter.language : undefined),
        taskType: normalizeText(typeof frontmatter.task_type === "string" ? frontmatter.task_type : undefined),
        portalType: normalizeText(typeof frontmatter.portal_type === "string" ? frontmatter.portal_type : undefined),
        tags,
      },
    };
  }

  private async selectAgentRole(
    request: RouterRequest,
    explicitAgentRole?: Opt<string, Reason.OptionalInput>,
  ): Promise<{ selectedAgentRole: string; policyDecision?: IRoutingPolicyDecision }> {
    const allowDynamicRouting = request.frontmatter.allow_dynamic_routing ??
      this.config.routing?.enable_dynamic_routing ?? false;
    if (!allowDynamicRouting || !this.routingPolicyService) {
      return { selectedAgentRole: explicitAgentRole ?? this.defaultAgentId };
    }

    try {
      const routingContext = this.buildRoutingContext(request);
      const frontmatter = request.frontmatter as RouterRequestFrontmatterMap;
      const decision = await this.routingPolicyService.selectAgentRole({
        explicitAgentRole,
        explicitVersion: typeof frontmatter.identity_version === "string" ? frontmatter.identity_version : undefined,
        requestText: routingContext.requestText,
        requestAnalysis: routingContext.requestAnalysis,
        portalName: routingContext.portalName,
        flowStepId: routingContext.flowStepId,
        matchCriteria: routingContext.matchCriteria,
        traceId: request.traceId,
        allowDynamicRouting: true,
      });

      return { selectedAgentRole: decision.selectedAgentRole, policyDecision: decision };
    } catch (error) {
      await this.eventLogger.log({
        action: "request.routing.policy.failed",
        target: request.requestId,
        payload: {
          error: error instanceof Error ? error.message : String(error),
          explicit_agent_role: explicitAgentRole ?? null,
        },
        traceId: request.traceId,
      });
      await this.eventLogger.log({
        action: "routing.fallback_used",
        target: request.requestId,
        payload: {
          fallback_agent_role: explicitAgentRole ?? this.defaultAgentId,
          reason: error instanceof Error ? error.message : String(error),
          allow_dynamic_routing: true,
        },
        traceId: request.traceId,
      });
      return { selectedAgentRole: explicitAgentRole ?? this.defaultAgentId };
    }
  }

  private async logRoutingDecision(
    requestId: string,
    traceId: string,
    basePayload: Record<string, JSONValue>,
    policyDecision: IRoutingPolicyDecision,
  ): Promise<void> {
    await this.eventLogger.log({
      action: "routing.decision",
      target: requestId,
      payload: {
        ...basePayload,
        allow_dynamic_routing: true,
        selected_agent_role: policyDecision.selectedAgentRole,
        selected_version: policyDecision.selectedVersion,
        strategy: policyDecision.strategy,
        matched_rule_id: policyDecision.matchedRuleId ?? null,
        rationale: policyDecision.rationale,
        candidate_count: policyDecision.candidates.length,
        top_candidates: policyDecision.candidates.slice(0, 5).map((candidate) => ({
          agent_role: candidate.agentRole,
          version: candidate.version,
          score: candidate.score,
          score_breakdown: candidate.scoreBreakdown,
        })),
      },
      traceId,
    });
  }

  private createParsedRequest(request: RouterRequest, allowDynamicRouting: boolean): IParsedRequest {
    // `skills` and `tags` must be forwarded here — AgentRunner's explicit skill override
    // and tag-based trigger matching read them from this parsed request.
    const parsedRequest: IParsedRequest = {
      userPrompt: request.body,
      context: {},
      traceId: request.traceId,
      requestId: request.requestId,
      allowDynamicRouting,
      skills: normalizeFrontmatterList(request.frontmatter?.skills),
      tags: normalizeFrontmatterList(request.frontmatter?.tags),
    };
    const portalContext = this.buildPortalContext(request.frontmatter?.portal);
    if (portalContext) {
      parsedRequest.context[PORTAL_CONTEXT_KEY] = portalContext;
    }
    return parsedRequest;
  }

  private buildPortalContext(portalAlias?: Opt<string, Reason.OptionalInput>): string | null {
    if (!portalAlias) return null;

    const portal = this.config.portals.find((p) => p.alias === portalAlias);
    if (!portal) {
      return null;
    }

    return buildPortalContextBlock({
      portalAlias,
      portalRoot: portal.target_path,
    });
  }
}
