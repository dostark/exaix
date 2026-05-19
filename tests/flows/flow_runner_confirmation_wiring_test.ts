/**
 * @module FlowRunnerConfirmationWiringTest
 * @path tests/flows/flow_runner_confirmation_wiring_test.ts
 * @description Verifies FlowRunner wires a real tool confirmation interceptor into DynamicStepExecutor.
 */

import { assertEquals, assertExists, assertInstanceOf } from "@std/assert";
import type { INotificationService } from "@exaix/core/types";
import { McpToolName } from "@exaix/mcp";
import { ToolsConfigSchema } from "@exaix/schemas/config.ts";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import type { JSONValue } from "@exaix/core/types";
import type { DynamicStepExecutor } from "../../src/flows/dynamic_step_executor.ts";
import { FlowRunner, type IFlowEventLogger } from "../../src/flows/flow_runner.ts";
import { ToolHandler } from "../../src/mcp/tool_handler.ts";
import { CliConfirmationInterceptor, NotificationQueueConfirmationInterceptor } from "../../src/services/tool/mod.ts";
import { createMockConfig } from "../helpers/config.ts";
import { createStubConfig, createStubContext, createStubDb } from "../helpers/test_helpers.ts";
import { StubNotificationServiceBase } from "../helpers/notification_service_stub_helpers.ts";

type IToolDefinition = ReturnType<ToolHandler["getToolDefinition"]>;

class FlowRunnerTestHarness extends FlowRunner {
  getDynamicStepExecutor(): DynamicStepExecutor | undefined {
    return this.dynamicStepExecutor;
  }
}

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

class MockNotificationService extends StubNotificationServiceBase {}

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

function createRunner(
  options: { tempRoot: string; notificationService?: INotificationService; timeoutSeconds?: number },
) {
  const config = createMockConfig(
    options.tempRoot,
    options.timeoutSeconds === undefined ? undefined : {
      tools: ToolsConfigSchema.parse({ confirmation_timeout_s: options.timeoutSeconds }),
    },
  );
  const context = createStubContext({
    config: createStubConfig(config),
    db: createStubDb(),
    notificationService: options.notificationService,
  });

  return new FlowRunnerTestHarness({
    agentExecutor: createAgentExecutor(),
    eventLogger: new NoopEventLogger(),
    context,
    dynamicHandlers: new Map([[McpToolName.READ_FILE, new StubReadHandler()]]),
  });
}

Deno.test("FlowRunner wires NotificationQueueConfirmationInterceptor when notificationService exists in context", () => {
  const runner = createRunner({
    tempRoot: "/tmp/flow-runner-confirmation-queue",
    notificationService: new MockNotificationService(),
  });

  const dynamicExecutor = runner.getDynamicStepExecutor();
  assertExists(dynamicExecutor, "FlowRunner should create DynamicStepExecutor when dynamic handlers are configured");

  assertInstanceOf(dynamicExecutor.confirmationInterceptor, NotificationQueueConfirmationInterceptor);
});

Deno.test("FlowRunner falls back to CliConfirmationInterceptor when notificationService is absent", () => {
  const runner = createRunner({ tempRoot: "/tmp/flow-runner-confirmation-cli" });

  const dynamicExecutor = runner.getDynamicStepExecutor();
  assertExists(dynamicExecutor, "FlowRunner should create DynamicStepExecutor when dynamic handlers are configured");

  assertInstanceOf(dynamicExecutor.confirmationInterceptor, CliConfirmationInterceptor);
});

Deno.test("FlowRunner passes confirmation_timeout_s from config to CliConfirmationInterceptor", () => {
  const runner = createRunner({
    tempRoot: "/tmp/flow-runner-confirmation-timeout",
    timeoutSeconds: 30,
  });

  const dynamicExecutor = runner.getDynamicStepExecutor();
  assertExists(dynamicExecutor);

  const interceptor = dynamicExecutor.confirmationInterceptor;
  assertInstanceOf(interceptor, CliConfirmationInterceptor);
  assertEquals(
    interceptor.timeoutMs,
    30_000,
    "CliConfirmationInterceptor timeoutMs must match config confirmation_timeout_s * 1000",
  );
});
