/**
 * @module DynamicFlowNativeToolsTest
 * @path packages/flow/tests/dynamic_flow_native_tools_test.ts
 * @description Exercises native dynamic tool calls through FlowRunner and both LlmClient construction paths.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/flow_runner.ts, packages/flow/src/dynamic_step_executor.ts]
 */
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { createMockConfig, createMockEventLogger, initTestDbService } from "@exaix/testing";
import { FlowRunner } from "@exaix/flow";
import type { IAgentExecutor, IFlowEventLogger, IFlowStepRequest } from "@exaix/flow";
import {
  DEFAULT_MILESTONE_STREAMING_ENABLED,
  FlowInputSource,
  FlowOutputFormat,
  FlowStepExecutionMode,
  FlowStepOnErrorAction,
  McpToolName,
  MockStrategy,
} from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import { DYNAMIC_MODE_APPROVAL_TOOLS, DYNAMIC_MODE_TOOLS } from "@exaix/mcp";
import type { IMcpClient, IMcpToolCallContext } from "@exaix/mcp";
import type { IToolManifestResolver } from "@exaix/core/types";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import { ProviderFactory, ProviderFactoryError } from "@exaix/ai";
import { ProviderRegistry } from "@exaix/ai";
import { TracedProvider } from "@exaix/ai";
import type { IModelOptions, IModelProvider, ToolArgs } from "@exaix/ai";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IFlowEventPayload } from "@exaix/flow";

class FlowAgent implements IAgentExecutor {
  run(_role: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    throw new Error("Dynamic flow must use DynamicStepExecutor");
  }
}

class DynamicMcp implements IMcpClient, IToolManifestResolver {
  calls: Array<{ tool: McpToolName; context?: IMcpToolCallContext }> = [];
  getToolDefinitions(tools: McpToolName[]) {
    return tools.map((name) => ({ name, description: `Read using ${name}`, inputSchema: { type: "object" as const } }));
  }
  requiresHumanApproval(_tool: McpToolName): boolean {
    return false;
  }
  callTool(tool: McpToolName, _args: ToolArgs, context?: IMcpToolCallContext): Promise<string> {
    this.calls.push({ tool, context });
    return Promise.resolve("source contents");
  }
}

class DynamicNativeProvider implements IModelProvider {
  readonly id = "dynamic-flow-test-model";
  calls: Array<{ prompt: string; options?: IModelOptions }> = [];
  generate(prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    this.calls.push({ prompt, options });
    const isFirst = this.calls.length === 1;
    return Promise.resolve({
      content: isFirst ? "" : "File reviewed",
      ...(isFirst
        ? { toolCalls: [{ id: "flow-call-1", name: McpToolName.READ_FILE, input: { path: "src/a.ts" } }] }
        : {}),
      usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
      costStatus: "unknown",
      model: "dynamic-flow-test-model",
      provider: "dynamic-flow-test",
    });
  }
}

ProviderRegistry.registerWithMetadata("dynamic-flow-test", {} as never, {
  supportsNativeTools: true,
  supportsNativeConversation: true,
} as never);

function writeRole(root: string): void {
  const agents = join(root, "Blueprints", "Agents");
  Deno.mkdirSync(agents, { recursive: true });
  Deno.writeTextFileSync(
    join(agents, "reader.md"),
    Deno.readTextFileSync(new URL("./fixtures/dynamic_native_reader.md", import.meta.url)),
  );
}

function dynamicFlow(onError?: { action: FlowStepOnErrorAction; maxRetries: number; backoffMs: number }): IFlowInput {
  return {
    id: "dynamic-native-flow",
    name: "Dynamic native flow",
    description: "Exercise the real FlowRunner dynamic path",
    steps: [{
      id: "read-source",
      name: "Inspect source",
      agent_role: "reader",
      execution_mode: FlowStepExecutionMode.DYNAMIC,
      permitted_tools: [McpToolName.READ_FILE],
      effort: "high",
      ...(onError ? { onError } : {}),
      input: { source: FlowInputSource.REQUEST },
      dependsOn: [],
    }],
    output: { from: "read-source", format: FlowOutputFormat.MARKDOWN },
  };
}

Deno.test("FlowRunner propagates provider reason and does not retry typed setup failures", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const originalCreateByName = ProviderFactory.createByName;
  const llmLogger = createMockEventLogger();
  const flowEvents: Array<{ event: string; payload: IFlowEventPayload<string> }> = [];
  let factoryCalls = 0;
  try {
    const config = createMockConfig(tempDir, {
      execution: { native_tools_enabled: true, milestone_streaming_enabled: DEFAULT_MILESTONE_STREAMING_ENABLED },
      ai: {
        provider: "mock",
        model: "test",
        timeout_ms: 30000,
        mock: { strategy: MockStrategy.RECORDED, fixtures_dir: tempDir },
      },
    });
    writeRole(tempDir);
    ProviderFactory.createByName = () => {
      factoryCalls++;
      return Promise.reject(new ProviderFactoryError("Provider credentials are missing", "credential_missing"));
    };
    const runner = new FlowRunner({
      agentExecutor: new FlowAgent(),
      eventLogger: {
        log: (event: string, payload: IFlowEventPayload<string>) => {
          flowEvents.push({ event, payload });
        },
      },
      llmEventLogger: llmLogger,
      config,
      db,
      dynamicModeTools: DYNAMIC_MODE_TOOLS,
      dynamicModeApprovalTools: DYNAMIC_MODE_APPROVAL_TOOLS,
      mcpClient: new DynamicMcp(),
    });
    await assertRejects(() =>
      runner.execute(
        dynamicFlow({
          action: FlowStepOnErrorAction.RETRY,
          maxRetries: 2,
          backoffMs: 1,
        }) as IFlow,
        { userPrompt: "Review src/a.ts", traceId: "trace-provider-failure" },
      ), Error);

    assertEquals(factoryCalls, 1);
    assertEquals(flowEvents.some(({ event }) => event === "flow.step.retry"), false);
    const failed = flowEvents.find(({ event }) => event === "flow.step.failed");
    assertExists(failed);
    assertEquals(failed.payload.providerReasonCode, "credential_missing");
    assertEquals(llmLogger.events.some((event) => event.action === "llm.call.started"), false);
  } finally {
    ProviderFactory.createByName = originalCreateByName;
    await cleanup();
  }
});

for (const useModelResolver of [false, true]) {
  Deno.test(`FlowRunner native dynamic flow passes trace, tools, and replay through ${useModelResolver ? "lazy" : "eager"} construction`, async () => {
    const { db, tempDir, cleanup } = await initTestDbService();
    const originalCreateByName = ProviderFactory.createByName;
    const provider = new DynamicNativeProvider();
    const mcp = new DynamicMcp();
    const llmLogger = createMockEventLogger();
    let factoryLogger: IEventLogger | undefined;
    try {
      const config = createMockConfig(tempDir, {
        execution: { native_tools_enabled: true, milestone_streaming_enabled: DEFAULT_MILESTONE_STREAMING_ENABLED },
        ai: {
          provider: "mock",
          model: "test",
          timeout_ms: 30000,
          mock: { strategy: MockStrategy.RECORDED, fixtures_dir: tempDir },
        },
      });
      writeRole(tempDir);
      ProviderFactory.createByName = (_config, _name, _db, logger) => {
        factoryLogger = logger;
        return Promise.resolve(logger ? new TracedProvider(provider, logger) : provider);
      };
      const flowEvents: Array<{ event: string; payload: IFlowEventPayload<string> }> = [];
      const eventLogger: IFlowEventLogger = {
        log: (event: string, payload: IFlowEventPayload<string>) => {
          flowEvents.push({ event, payload });
        },
      };
      const runner = new FlowRunner({
        agentExecutor: new FlowAgent(),
        eventLogger,
        llmEventLogger: llmLogger,
        tokenizer: {
          countTokens: (text: string) => Promise.resolve(text.length),
          countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((text) => text.length)),
        },
        config,
        db,
        dynamicModeTools: DYNAMIC_MODE_TOOLS,
        dynamicModeApprovalTools: DYNAMIC_MODE_APPROVAL_TOOLS,
        mcpClient: mcp,
        ...(useModelResolver
          ? {
            modelResolver: {
              resolve: () =>
                Promise.resolve({
                  provider: "dynamic-flow-test",
                  model: "dynamic-flow-test-model",
                  attempt: 1,
                  options: { effort: "medium" },
                }),
            } as never,
          }
          : {}),
      });
      const result = await runner.execute(dynamicFlow() as IFlow, {
        userPrompt: "Review src/a.ts",
        traceId: "trace-flow-dynamic",
      });

      assertEquals(result.success, true);
      assertEquals(mcp.calls.length, 1);
      assertEquals(mcp.calls[0].tool, McpToolName.READ_FILE);
      assertEquals(mcp.calls[0].context?.traceId, "trace-flow-dynamic");
      assertEquals(provider.calls.length, 2);
      assertEquals(provider.calls[0].options?.tools?.map((tool) => tool.name), [McpToolName.READ_FILE]);
      assertEquals(provider.calls[0].options?.nativeConversation?.turns.length, 0);
      assertEquals(provider.calls[1].options?.nativeConversation?.turns[0].toolUseId, "flow-call-1");
      assertEquals(provider.calls[0].options?.traceId, "trace-flow-dynamic");
      assertEquals(provider.calls[0].options?.effort, useModelResolver ? "medium" : "high");
      const completed = flowEvents.find(({ event }) => event === "dynamic_step_completed");
      assertExists(completed);
      assertEquals(completed.payload.promptTokens, 24);
      assertEquals(completed.payload.completionTokens, 8);
      assertEquals(completed.payload.costStatus, "unknown");
      assertEquals(Object.hasOwn(completed.payload, "cost_usd"), false);
      assertExists(factoryLogger);
      assertEquals(
        llmLogger.events.some((event) => event.action === "llm.call.started" && event.traceId === "trace-flow-dynamic"),
        true,
      );
      assertEquals(
        llmLogger.events.some((event) =>
          event.action === "llm.call.completed" && event.traceId === "trace-flow-dynamic"
        ),
        true,
      );
    } finally {
      ProviderFactory.createByName = originalCreateByName;
      await cleanup();
    }
  });
}
