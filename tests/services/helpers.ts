/**
 * @module ServicesTestHelpers
 * @path tests/services/helpers.ts
 * @description Provides shared mock factories and context simulators for validating
 * core service logic in isolation.
 */

import { type IFlowValidator, RequestRouter } from "../../src/services/request/request_router.ts";
import type { IFlowResult, IFlowRunner } from "../../src/flows/flow_runner.ts";
import type {
  IAgentExecutionResult,
  IAgentRunner,
  IBlueprint,
  IParsedRequest,
} from "../../src/services/agent/agent_runner.ts";
import type { IRoutingPolicyService } from "../../src/services/routing/routing_policy_service.ts";
import type { IFlow } from "../../src/shared/schemas/flow.ts";
import type { Config } from "../../src/shared/schemas/config.ts";
import type { ILogEvent } from "../../src/services/common/types.ts";
import type { EventLogger, IEventLogger } from "../../src/services/core/event_logger.ts";
import type { IRequestFrontmatter } from "../../src/services/request_processing/types.ts";
import type { JSONValue, LogMetadata } from "../../src/shared/types/json.ts";
import { LogLevel } from "../../src/shared/enums.ts";
import { createTestConfig } from "../ai/helpers/test_config.ts";

type IMockFlowRunner = IFlowRunner & {
  executedFlows: Array<{ flow: IFlow; request: { userPrompt: string; traceId?: string; requestId?: string } }>;
};

type IMockAgentRunner = IAgentRunner & {
  executedAgents: Array<{ blueprint: IBlueprint; request: IParsedRequest }>;
};

type IFlowValidationResponse = { valid: boolean; error?: string };

type IMockFlowValidator = IFlowValidator & {
  validFlows: Set<string>;
  invalidFlows: Set<string>;
};

type IMockEventLogger = IEventLogger & {
  events: Array<{ action: string; target: string; payload?: Record<string, JSONValue>; traceId?: string }>;
};

type IRouterRequestSample = {
  traceId: string;
  requestId: string;
  frontmatter: IRequestFrontmatter;
  body: string;
};

type IRouterTestContext = {
  mockFlowRunner: IMockFlowRunner;
  mockAgentRunner: IMockAgentRunner;
  mockFlowValidator: IMockFlowValidator;
  mockLogger: IMockEventLogger;
  router: RequestRouter;
};

export function createMockFlowRunner(): IMockFlowRunner {
  class MockFlowRunner implements IFlowRunner {
    executedFlows: Array<{ flow: IFlow; request: { userPrompt: string; traceId?: string; requestId?: string } }> = [];

    execute(flow: IFlow, request: { userPrompt: string; traceId?: string; requestId?: string }): Promise<IFlowResult> {
      this.executedFlows.push({ flow, request });
      return Promise.resolve({
        flowRunId: "test-run",
        success: true,
        stepResults: new Map(),
        output: `Flow ${flow.id} executed`,
        duration: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      });
    }
  }
  return new MockFlowRunner();
}

export function createMockAgentRunner(): IMockAgentRunner {
  class MockAgentRunner implements IAgentRunner {
    executedAgents: Array<{ blueprint: IBlueprint; request: IParsedRequest }> = [];

    run(blueprint: IBlueprint, request: IParsedRequest): Promise<IAgentExecutionResult> {
      this.executedAgents.push({ blueprint, request });
      return Promise.resolve({
        thought: "thought",
        content: `Agent ${blueprint.identityId} executed`,
        raw: "raw",
      });
    }
  }
  return new MockAgentRunner();
}

export function createMockFlowValidator(): IMockFlowValidator {
  class MockFlowValidator implements IFlowValidator {
    validFlows = new Set(["code-review", "deploy", "research"]);
    invalidFlows = new Set(["broken-flow", "missing-deps"]);

    validateFlow(flowId: string): Promise<IFlowValidationResponse> {
      if (this.validFlows.has(flowId)) {
        return Promise.resolve({ valid: true });
      }
      if (this.invalidFlows.has(flowId)) {
        return Promise.resolve({ valid: false, error: `Flow '${flowId}' has validation errors` });
      }
      return Promise.resolve({ valid: false, error: `Flow '${flowId}' not found` });
    }
  }

  return new MockFlowValidator();
}

export function createMockEventLogger(): IMockEventLogger {
  class MockEventLogger implements IEventLogger {
    events: Array<{ action: string; target: string; payload?: Record<string, JSONValue>; traceId?: string }> = [];

    log(event: ILogEvent): Promise<void> {
      this.events.push({
        action: event.action,
        target: event.target,
        payload: event.payload,
        traceId: event.traceId,
      });
      return Promise.resolve();
    }

    info(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void> {
      return this.log({
        level: LogLevel.INFO,
        action,
        target: target ?? "",
        payload: payload as Record<string, JSONValue>,
        traceId,
      });
    }

    warn(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void> {
      return this.log({
        level: LogLevel.WARN,
        action,
        target: target ?? "",
        payload: payload as Record<string, JSONValue>,
        traceId,
      });
    }

    error(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void> {
      return this.log({
        level: LogLevel.ERROR,
        action,
        target: target ?? "",
        payload: payload as Record<string, JSONValue>,
        traceId,
      });
    }

    fatal(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void> {
      return this.log({
        level: LogLevel.FATAL,
        action,
        target: target ?? "",
        payload: payload as Record<string, JSONValue>,
        traceId,
      });
    }

    debug(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void> {
      return this.log({
        level: LogLevel.DEBUG,
        action,
        target: target ?? "",
        payload: payload as Record<string, JSONValue>,
        traceId,
      });
    }

    child(_overrides: Partial<ILogEvent>): IEventLogger {
      return this;
    }
  }

  return new MockEventLogger();
}

export function createTestRequestRouter(
  {
    flowRunner,
    agentRunner,
    flowValidator,
    logger,
    routingPolicyService,
    defaultAgent = "default-agent",
    blueprintsPath = "/tmp/blueprints",
    config = createTestConfig(),
  }: {
    flowRunner: IFlowRunner;
    agentRunner: IAgentRunner;
    flowValidator: IFlowValidator;
    logger: IEventLogger;
    routingPolicyService?: IRoutingPolicyService;
    defaultAgent?: string;
    blueprintsPath?: string;
    config?: Config;
  },
): RequestRouter {
  class TestRequestRouter extends RequestRouter {
    private mockBlueprints: Map<string, IBlueprint> = new Map();

    constructor() {
      super({
        flowRunner,
        agentRunner,
        flowValidator,
        eventLogger: logger as EventLogger,
        defaultAgentId: defaultAgent,
        blueprintsPath,
        config,
        routingPolicyService,
      });
      this.mockBlueprints.set("senior-coder", { identityId: "senior-coder", systemPrompt: "Senior Coder" });
      this.mockBlueprints.set("default-agent", { identityId: "default-agent", systemPrompt: "Default Agent" });
    }

    protected override loadBlueprint(identityId: string): Promise<IBlueprint | null> {
      return Promise.resolve(this.mockBlueprints.get(identityId) || null);
    }
  }

  return new TestRequestRouter();
}

export function sampleRouterRequest(overrides: {
  traceId?: string;
  requestId?: string;
  frontmatter?: Partial<IRequestFrontmatter>;
  body?: string;
} = {}): IRouterRequestSample {
  return {
    traceId: overrides.traceId ?? "test-trace-123",
    requestId: overrides.requestId ?? "req-123",
    frontmatter: {
      trace_id: "test-trace-123",
      created: new Date().toISOString(),
      status: "pending",
      priority: "normal",
      source: "test",
      created_by: "tester",
      ...(overrides.frontmatter ?? {}),
    } as IRequestFrontmatter,
    body: overrides.body ?? "Test request body",
  };
}

/**
 * Creates a complete test context for RequestRouter tests with all mocks wired up.
 * Reduces boilerplate in tests that repeat the same setup pattern.
 */
export function createRouterTestContext(overrides: {
  defaultAgent?: string;
  blueprintsPath?: string;
  routingPolicyService?: IRoutingPolicyService;
  config?: Config;
} = {}): IRouterTestContext {
  const mockFlowRunner = createMockFlowRunner();
  const mockAgentRunner = createMockAgentRunner();
  const mockFlowValidator = createMockFlowValidator();
  const mockLogger = createMockEventLogger();
  const router = createTestRequestRouter({
    flowRunner: mockFlowRunner,
    agentRunner: mockAgentRunner,
    flowValidator: mockFlowValidator,
    logger: mockLogger,
    routingPolicyService: overrides.routingPolicyService,
    defaultAgent: overrides.defaultAgent ?? "default-agent",
    blueprintsPath: overrides.blueprintsPath ?? "/tmp/blueprints",
    config: overrides.config,
  });

  return {
    mockFlowRunner,
    mockAgentRunner,
    mockFlowValidator,
    mockLogger,
    router,
  };
}
