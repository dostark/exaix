/**
 * @module FlowRunnerConfirmationIntegrationTest
 * @path tests/flows/flow_runner_confirmation_integration_test.ts
 * @description End-to-end FlowRunner tests for Phase 79 approval and denial via the real notification queue interceptor path.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { StubNotificationServiceBase } from "../helpers/notification_service_stub_helpers.ts";
import {
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  DEFAULT_FLOW_VERSION,
  FlowInputSource,
  FlowOutputFormat,
  FlowStepExecutionMode,
} from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import type { IFlow, IFlowInput, IFlowStepInput } from "@exaix/schemas/flow.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "../../packages/ai/src/types.ts";
import { ProviderFactory } from "../../packages/ai/src/provider_factory.ts";
import type { Config } from "@exaix/schemas";
import { FlowRunner, type IAgentExecutor, type IFlowEventLogger, type IFlowStepRequest } from "@exaix/flow";
import { ToolHandler } from "@exaix/mcp/server";
import { initTestDbService } from "@exaix/testing";
import { createStubConfig, createStubContext } from "@exaix/testing";
import type { JSONValue } from "@exaix/core/types";

type IToolDefinition = ReturnType<ToolHandler["getToolDefinition"]>;

class NoopEventLogger implements IFlowEventLogger {
  log<TEvent extends string>(_event: TEvent, _payload: Record<string, JSONValue>): void {}
}

class FailingAgentExecutor implements IAgentExecutor {
  run(_identityId: string, _request: IFlowStepRequest) {
    return Promise.reject(new Error("Dynamic step should not fall back to declared agent execution"));
  }
}

class RecordingCreateRequestHandler extends ToolHandler {
  calls: Array<Record<string, JSONValue>> = [];

  constructor() {
    super(createStubContext());
  }

  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    this.calls.push(args);
    return await Promise.resolve({
      content: [{ type: "text", text: `request created for ${(args.title as string) ?? "unknown"}` }],
    });
  }

  getToolDefinition(): IToolDefinition {
    return {
      name: McpToolName.CREATE_REQUEST,
      description: "Create a request record",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
        },
        required: ["title"],
      },
    };
  }
}

class DecisionWritingNotificationService extends StubNotificationServiceBase {
  constructor(
    private readonly writer: (proposalId: string) => Promise<void>,
  ) {
    super();
  }

  override async notify(
    _message: string,
    _type?: string,
    proposalId?: string,
  ): Promise<void> {
    if (proposalId) {
      await this.writer(proposalId);
    }
  }
}

function installMockProvider(responses: string[]) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(ProviderFactory, "createByName")!;
  let callCount = 0;

  const provider: IModelProvider = {
    id: "phase79-flow-runner-mock",
    generate: (_prompt: string): Promise<IGenerateResult> => {
      const response = responses[Math.min(callCount, responses.length - 1)];
      callCount++;
      return Promise.resolve({
        content: response,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "phase79-flow-runner-mock",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };

  Object.defineProperty(ProviderFactory, "createByName", {
    value: async (_config: Config, _name: string) => {
      await Promise.resolve();
      return provider;
    },
    writable: true,
    configurable: true,
  });

  return () => {
    Object.defineProperty(ProviderFactory, "createByName", originalDescriptor);
  };
}

async function writeBlueprint(tempDir: string): Promise<void> {
  const identitiesDir = join(tempDir, "Blueprints", "Identities");
  await Deno.mkdir(identitiesDir, { recursive: true });
  await Deno.writeTextFile(
    join(identitiesDir, "senior-coder.md"),
    `---
identity_id: "senior-coder"
name: "Senior Coder"
model: "mock:test"
description: "Handles dynamic approval-required tool calls"
created: "2026-05-18T10:00:00.000Z"
created_by: "test"
permitted_tools:
  - "exaix_create_request"
---

You are a senior engineer executing dynamic tool calls.
`,
  );
}

function createDynamicApprovalFlow(): IFlow {
  const steps: IFlowStepInput[] = [
    {
      id: "dynamic-create-request",
      name: "Create request if needed",
      identity: "senior-coder",
      execution_mode: FlowStepExecutionMode.DYNAMIC,
      permitted_tools: [McpToolName.CREATE_REQUEST],
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
    },
  ];

  const flow: IFlowInput = {
    id: "phase79-confirmation-flow",
    name: "Phase 79 Confirmation Flow",
    description: "Exercises approval-required dynamic tools via FlowRunner",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "dynamic-create-request", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 1, failFast: true },
  };

  return flow as IFlow;
}

Deno.test("FlowRunner confirmation integration: approval executes the tool and completes the dynamic step", async () => {
  const { db, config, tempDir, cleanup } = await initTestDbService();
  const handler = new RecordingCreateRequestHandler();
  const restoreProvider = installMockProvider([
    JSON.stringify({
      reasoning: "A request should be created",
      action: {
        type: "tool_call",
        tool: "exaix_create_request",
        args: { title: "Create approved request" },
      },
    }),
    JSON.stringify({
      reasoning: "The step is complete",
      action: { type: "complete" },
    }),
  ]);

  try {
    await writeBlueprint(tempDir);

    const notificationService = new DecisionWritingNotificationService((proposalId) =>
      db.writeToolConfirmationDecision(proposalId, {
        approved: true,
        decidedAt: "2026-05-18T10:00:30.000Z",
        decidedBy: "test-approver",
      })
    );

    const context = createStubContext({
      config: createStubConfig(config),
      db,
      notificationService,
    });

    const runner = new FlowRunner({
      agentExecutor: new FailingAgentExecutor(),
      eventLogger: new NoopEventLogger(),
      context,
      dynamicHandlers: new Map([[McpToolName.CREATE_REQUEST, handler]]),
    });

    const result = await runner.execute(createDynamicApprovalFlow(), {
      userPrompt: "Create a request for the approved case",
      traceId: crypto.randomUUID(),
    });

    assertEquals(result.success, true);
    assertEquals(handler.calls.length, 1);
    assertEquals(handler.calls[0].title, "Create approved request");
    assertStringIncludes(result.output, "request created for Create approved request");
  } finally {
    restoreProvider();
    await cleanup();
  }
});

Deno.test("FlowRunner confirmation integration: denial skips tool execution and returns the denial observation", async () => {
  const { db, config, tempDir, cleanup } = await initTestDbService();
  const handler = new RecordingCreateRequestHandler();
  const restoreProvider = installMockProvider([
    JSON.stringify({
      reasoning: "A request should be created",
      action: {
        type: "tool_call",
        tool: "exaix_create_request",
        args: { title: "Create denied request" },
      },
    }),
    JSON.stringify({
      reasoning: "No further action required",
      action: { type: "complete" },
    }),
  ]);

  try {
    await writeBlueprint(tempDir);

    const notificationService = new DecisionWritingNotificationService((proposalId) =>
      db.writeToolConfirmationDecision(proposalId, {
        approved: false,
        reason: "User declined",
        decidedAt: "2026-05-18T10:00:45.000Z",
        decidedBy: "test-reviewer",
      })
    );

    const context = createStubContext({
      config: createStubConfig(config),
      db,
      notificationService,
    });

    const runner = new FlowRunner({
      agentExecutor: new FailingAgentExecutor(),
      eventLogger: new NoopEventLogger(),
      context,
      dynamicHandlers: new Map([[McpToolName.CREATE_REQUEST, handler]]),
    });

    const result = await runner.execute(createDynamicApprovalFlow(), {
      userPrompt: "Create a request for the denied case",
      traceId: crypto.randomUUID(),
    });

    assertEquals(result.success, true);
    assertEquals(handler.calls.length, 0);
    assertStringIncludes(result.output, "Tool 'exaix_create_request' call denied: User declined");
  } finally {
    restoreProvider();
    await cleanup();
  }
});
