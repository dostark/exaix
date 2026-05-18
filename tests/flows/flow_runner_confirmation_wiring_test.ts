/**
 * @module FlowRunnerConfirmationWiringTest
 * @path tests/flows/flow_runner_confirmation_wiring_test.ts
 * @description Verifies FlowRunner wires a real tool confirmation interceptor into DynamicStepExecutor.
 */

import { assertExists, assertInstanceOf } from "@std/assert";
import type { INotificationService } from "@exaix/core/types";
import type { IToolConfirmationInterceptor } from "@exaix/core/types/tool_confirmation_interceptor.ts";
import { McpToolName } from "@exaix/mcp";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import type { JSONValue } from "@exaix/core/types/json.ts";
import { FlowRunner, type IFlowEventLogger } from "../../src/flows/flow_runner.ts";
import type { DynamicStepExecutor } from "../../src/flows/dynamic_step_executor.ts";
import { ToolHandler } from "../../src/mcp/tool_handler.ts";
import { CliConfirmationInterceptor, NotificationQueueConfirmationInterceptor } from "../../src/services/tool/mod.ts";
import { createMockConfig } from "../helpers/config.ts";
import { createStubConfig, createStubContext, createStubDb } from "../helpers/test_helpers.ts";

type IToolDefinition = ReturnType<ToolHandler["getToolDefinition"]>;

type IFlowRunnerWithDynamicExecutor = FlowRunner & { dynamicStepExecutor?: DynamicStepExecutor };
type IDynamicExecutorWithInterceptor = DynamicStepExecutor & {
  confirmationInterceptor?: IToolConfirmationInterceptor;
};

class StubReadHandler extends ToolHandler {
  constructor() {
    super(createStubContext());
  }

  async execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    await Promise.resolve();
    return { content: [{ type: "text", text: "stub content" }] };
  }

  getToolDefinition(): IToolDefinition {
    return {
      name: McpToolName.READ_FILE,
      description: "Stub read_file for FlowRunner confirmation wiring test",
      inputSchema: { type: "object", properties: {} },
    };
  }
}

class NoopEventLogger implements IFlowEventLogger {
  log<TEvent extends string>(_event: TEvent, _payload: Record<string, JSONValue>): void {}
}

class MockNotificationService implements INotificationService {
  notifyMemoryUpdate(): Promise<void> {
    return Promise.resolve();
  }

  notify(): Promise<void> {
    return Promise.resolve();
  }

  notifyApproval(): void {}

  notifyRejection(): void {}

  getNotifications() {
    return Promise.resolve([]);
  }

  getPendingCount(): Promise<number> {
    return Promise.resolve(0);
  }

  notifyPendingDigestIfNeeded(): Promise<boolean> {
    return Promise.resolve(false);
  }

  clearNotification(): Promise<void> {
    return Promise.resolve();
  }

  clearAllNotifications(): Promise<void> {
    return Promise.resolve();
  }
}

function createAgentExecutor() {
  return {
    run: () =>
      Promise.resolve({
        thought: "",
        content: "done",
        raw: "",
        tokensUsed: { input: 0, output: 0 },
      }),
  };
}

Deno.test("FlowRunner wires NotificationQueueConfirmationInterceptor when notificationService exists in context", () => {
  const config = createMockConfig("/tmp/flow-runner-confirmation-queue");
  const context = createStubContext({
    config: createStubConfig(config),
    db: createStubDb(),
    notificationService: new MockNotificationService(),
  });

  const runner = new FlowRunner({
    agentExecutor: createAgentExecutor(),
    eventLogger: new NoopEventLogger(),
    context,
    dynamicHandlers: new Map([[McpToolName.READ_FILE, new StubReadHandler()]]),
  });

  const dynamicExecutor = (runner as IFlowRunnerWithDynamicExecutor).dynamicStepExecutor;
  assertExists(dynamicExecutor, "FlowRunner should create DynamicStepExecutor when dynamic handlers are configured");

  const confirmationInterceptor = (dynamicExecutor as IDynamicExecutorWithInterceptor).confirmationInterceptor;
  assertInstanceOf(confirmationInterceptor, NotificationQueueConfirmationInterceptor);
});

Deno.test("FlowRunner falls back to CliConfirmationInterceptor when notificationService is absent", () => {
  const config = createMockConfig("/tmp/flow-runner-confirmation-cli");
  const context = createStubContext({
    config: createStubConfig(config),
    db: createStubDb(),
  });

  const runner = new FlowRunner({
    agentExecutor: createAgentExecutor(),
    eventLogger: new NoopEventLogger(),
    context,
    dynamicHandlers: new Map([[McpToolName.READ_FILE, new StubReadHandler()]]),
  });

  const dynamicExecutor = (runner as IFlowRunnerWithDynamicExecutor).dynamicStepExecutor;
  assertExists(dynamicExecutor, "FlowRunner should create DynamicStepExecutor when dynamic handlers are configured");

  const confirmationInterceptor = (dynamicExecutor as IDynamicExecutorWithInterceptor).confirmationInterceptor;
  assertInstanceOf(confirmationInterceptor, CliConfirmationInterceptor);
});
