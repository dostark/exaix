/**
 * @module RequestRouter
 * @path src/services/request/request_router.ts
 * @description Determines whether to route a request to FlowRunner or AgentRunner
 * based on the request schema (flow vs agent fields).
 *
 * Provides a unified entry point for request processing, enabling seamless
 * transition between orchestrated flows and individual agent executions.
 *
 * @architectural-layer Services
 * * @related-files [src/services/request/request_processor.ts, src/services/flows/flow_runner.ts, src/services/flow/flow_validator.ts]
 */
import { type IFlowResult, type IFlowRunner } from "../../flows/flow_runner.ts";
import {
  type IAgentExecutionResult,
  type IAgentRunner,
  type IBlueprint,
  type IParsedRequest,
} from "../agent/agent_runner.ts";
import { EventLogger } from "../core/event_logger.ts";
import { BlueprintLoader } from "../blueprint/blueprint_loader.ts";
import { IWorkspaceExecutionContext, WorkspaceExecutionContextBuilder } from "../portal/workspace_execution_context.ts";
import type { Config, IPortalConfig } from "../../shared/schemas/config.ts";
import { PORTAL_CONTEXT_KEY } from "../../shared/constants.ts";
import { buildPortalContextBlock } from "../context/prompt_context.ts";
import type { IRequestFrontmatter } from "../request_processing/types.ts";
import type { IFlow } from "../../shared/schemas/flow.ts";
import { GitBranchName, RequestKind } from "../../shared/enums.ts";

/**
 * RequestRouter - Routes requests to appropriate execution engine
 * Implements Step 7.6 of the Exaix Implementation Plan
 *
 * Routing Priority:
 * 1. flow: <id> → FlowRunner (multi-agent)
 * 2. agent: <id> → AgentRunner (single-agent)
 * 3. Neither → Default agent
 */

export interface IRoutingDecision {
  type: RequestKind;
  flowId?: string;
  identityId?: string;
  result: IAgentExecutionResult | IFlowResult;
}

/** Typed request shape used by the router's internal methods */
interface RouterRequest {
  traceId: string;
  requestId: string;
  frontmatter: IRequestFrontmatter;
  body: string;
}

export class RoutingError extends Error {
  constructor(message: string, public readonly requestId?: string) {
    super(message);
    this.name = "RoutingError";
  }
}

export interface IFlowValidator {
  validateFlow(flowId: string): Promise<{ valid: boolean; error?: string }>;
}

import { IApplicationContext } from "../../shared/interfaces/i_application_context.ts";

export interface IRequestRouterConfig {
  flowRunner: IFlowRunner;
  agentRunner: IAgentRunner;
  flowValidator: IFlowValidator;
  eventLogger: EventLogger;
  defaultAgentId: string;
  blueprintsPath: string;
  config: Config;
  context?: IApplicationContext;
}

/**
 * RequestRouter handles routing decisions for incoming requests
 */
export class RequestRouter {
  private flowRunner: IFlowRunner;
  private agentRunner: IAgentRunner;
  private flowValidator: IFlowValidator;
  private eventLogger: EventLogger;
  private defaultAgentId: string;
  private blueprintsPath: string;
  private config: Config;

  constructor(options: IRequestRouterConfig) {
    const ctx = options.context;
    this.flowRunner = options.flowRunner;
    this.agentRunner = options.agentRunner;
    this.flowValidator = options.flowValidator;
    this.eventLogger = options.eventLogger;
    this.defaultAgentId = options.defaultAgentId;
    this.blueprintsPath = options.blueprintsPath;
    this.config = ctx?.config.get() || options.config;
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
        identities_allowed: portal.identities_allowed ?? ["*"],
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
    const identityId = frontmatter.identity;

    // Check for conflicting fields
    if (flowId && identityId) {
      await this.eventLogger.log({
        action: "request.routing.error",
        target: requestId,
        payload: {
          error: "Request cannot specify both 'flow' and 'identity' fields",
          field: "conflict",
          value: `${flowId}/${identityId}`,
        },
        traceId,
      });
      throw new RoutingError(
        "Request cannot specify both 'flow' and 'identity' fields",
        requestId,
      );
    }

    // Route to flow if specified
    if (flowId) {
      return await this.routeToFlow(flowId, request);
    }

    // Route to agent if specified
    if (identityId) {
      return await this.routeToAgent(identityId, request);
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
      },
    );

    return {
      type: RequestKind.FLOW,
      flowId,
      result,
    };
  }

  public async routeToAgent(identityId: string, request: RouterRequest): Promise<IRoutingDecision> {
    const { traceId, requestId, body } = request;

    // Log routing decision
    await this.eventLogger.log({
      action: "request.routing.identity",
      target: requestId,
      payload: { identityId },
      traceId,
    });

    // Load blueprint
    const blueprint = await this.loadBlueprint(identityId);
    if (!blueprint) {
      throw new RoutingError(`Agent blueprint not found: ${identityId}`, requestId);
    }

    // Create parsed request
    const parsedRequest: IParsedRequest = {
      userPrompt: body,
      context: {},
      traceId,
      requestId,
    };
    const portalContext = this.buildPortalContext(request.frontmatter?.portal);
    if (portalContext) {
      parsedRequest.context[PORTAL_CONTEXT_KEY] = portalContext;
    }

    // Execute agent
    const result = await this.agentRunner.run(blueprint, parsedRequest);

    return {
      type: RequestKind.IDENTITY,
      identityId,
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

    // Load default blueprint
    const blueprint = await this.loadBlueprint(this.defaultAgentId);
    if (!blueprint) {
      throw new RoutingError(`Default agent blueprint not found: ${this.defaultAgentId}`, requestId);
    }

    // Create parsed request
    const parsedRequest: IParsedRequest = {
      userPrompt: request.body,
      context: {},
      traceId,
      requestId,
    };
    const portalContext = this.buildPortalContext(request.frontmatter?.portal);
    if (portalContext) {
      parsedRequest.context[PORTAL_CONTEXT_KEY] = portalContext;
    }

    // Execute default agent
    const result = await this.agentRunner.run(blueprint, parsedRequest);

    return {
      type: RequestKind.IDENTITY,
      identityId: this.defaultAgentId,
      result,
    };
  }

  /**
   * Load an agent blueprint from the blueprints directory
   * Uses unified BlueprintLoader for consistent parsing
   */
  protected async loadBlueprint(identityId: string): Promise<IBlueprint | null> {
    const loader = new BlueprintLoader({ blueprintsPath: this.blueprintsPath });
    const loaded = await loader.load(identityId);
    if (!loaded) {
      return null;
    }
    return loader.toLegacyBlueprint(loaded);
  }

  private buildPortalContext(portalAlias?: string): string | null {
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
