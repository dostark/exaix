/**
 * @module FlowDynamicModelResolveTest
 * @path packages/flow/tests/flow_dynamic_model_resolve_test.ts
 * @description Phase 132 Step 4 — validates that FlowRunner lazily resolves
 *   dynamic model via ModelResolver when executing a flow with dynamic steps.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing, @exaix/schemas, @exaix/ai]
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { createMockConfig, initTestDbService } from "@exaix/testing";
import { FlowRunner } from "@exaix/flow";
import type { IAgentExecutor, IFlowEventLogger, IFlowStepRequest } from "@exaix/flow";
import { FlowInputSource, FlowOutputFormat, FlowStepExecutionMode, MockStrategy } from "@exaix/core";
import type { JSONValue } from "@exaix/core/types";
import type { IToolManifestResolver } from "@exaix/core/types";
import { type IMcpClient, McpToolName } from "@exaix/mcp";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IModelIntent } from "@exaix/schemas/model_intent.ts";
import type { IModelCallOptions } from "@exaix/schemas/model_intent.ts";
import type { ModelResolver, ToolArgs } from "@exaix/ai";
import {
  DynamicStepExecutor,
  type IDynamicStepExecutorOptions,
  type JournalEntry,
} from "../src/dynamic_step_executor.ts";
import type { IFlowStep } from "@exaix/schemas/flow.ts";
import type { IBlueprintFrontmatter } from "@exaix/schemas/blueprint.ts";
import { FlowStepSchema } from "@exaix/schemas";
import type { ILlmClient } from "@exaix/ai";

class MockAgentRunner implements IAgentExecutor {
  run(_identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    return Promise.resolve({ thought: "", content: "mock-result", raw: "mock-result" });
  }
}

const noopLogger: IFlowEventLogger = { log: () => {} };

function createMockFlow(stepId = "step1"): IFlowInput {
  return {
    id: "test-flow",
    name: "Test Flow",
    description: "Flow for dynamic model resolve test",
    steps: [
      {
        id: stepId,
        name: "Step 1",
        agent_role: "agent1",
        input: { source: FlowInputSource.REQUEST },
        dependsOn: [] as string[],
      },
    ],
    output: { from: stepId, format: FlowOutputFormat.MARKDOWN },
  };
}

Deno.test("[step132.4][dynamic-model] FlowRunner ensures dynamic executor with ModelResolver on execute", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    let resolvedIntent: IModelIntent | undefined;
    const mockResolver = {
      resolve: (intent: IModelIntent) => {
        resolvedIntent = intent;
        return Promise.resolve({ provider: "mock", model: "mock-model", attempt: 1 });
      },
    } as ModelResolver;

    const runner = new FlowRunner({
      agentExecutor: new MockAgentRunner(),
      eventLogger: noopLogger,
      config,
      db,
      modelResolver: mockResolver,
      dynamicModel: "medium",
      dynamicHandlers: new Map(),
    });

    const flow = createMockFlow();
    await runner.execute(flow as IFlow, { userPrompt: "test" });

    assertExists(resolvedIntent);
    assertEquals(resolvedIntent.model_size, "M");
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.4][dynamic-model] FlowRunner with unknown dynamicModel falls through gracefully", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    let resolvedIntent: IModelIntent | undefined;
    const mockResolver = {
      resolve: (intent: IModelIntent) => {
        resolvedIntent = intent;
        return Promise.resolve({ provider: "mock", model: "mock-model", attempt: 1 });
      },
    } as ModelResolver;

    const runner = new FlowRunner({
      agentExecutor: new MockAgentRunner(),
      eventLogger: noopLogger,
      config,
      db,
      modelResolver: mockResolver,
      dynamicModel: "unknown",
      dynamicHandlers: new Map(),
    });

    const flow = createMockFlow();
    await runner.execute(flow as IFlow, { userPrompt: "test" });

    assertExists(resolvedIntent);
    assertEquals(resolvedIntent.model_size, undefined);
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.4][dynamic-model] FlowRunner without modelResolver completes successfully", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const runner = new FlowRunner({
      agentExecutor: new MockAgentRunner(),
      eventLogger: noopLogger,
      config,
      db,
      dynamicModel: "medium",
      dynamicHandlers: new Map(),
    });

    const flow = createMockFlow();
    const result = await runner.execute(flow as IFlow, { userPrompt: "test" });
    assertEquals(result.success, true);
  } finally {
    await cleanup();
  }
});

// Lazy-executor propagation to the step handler

/** ReAct completion fixture whose prompt preview matches the dynamic step's ReAct prompt. */
const REACT_COMPLETE_FIXTURE = {
  promptHash: "0000000000000000000000000000000000000000000000000000000000000000",
  promptPreview: "\nYou are Senior Software Engineer,",
  response: JSON.stringify({
    reasoning: "Exploration objective met; no further tool calls needed.",
    action: { type: "complete", output: "Wiring probe complete." },
  }),
  model: "test",
  tokens: { input: 10, output: 10 },
  recordedAt: "2026-08-13T00:00:00Z",
};

function writeAgentIdentity(root: string): void {
  const dir = join(root, "Blueprints", "Agents");
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(
    join(dir, "agent1.md"),
    [
      "---",
      'agent_role: "agent1"',
      'name: "Senior Software Engineer"',
      'model: ""',
      "permitted_tools:",
      "  - read_file",
      "  - list_directory",
      "  - search_files",
      "---",
      "",
      "Test identity for the dynamic step executor.",
      "",
    ].join("\n"),
  );
}

function createDynamicFlow(): IFlowInput {
  return {
    id: "test-flow-dynamic",
    name: "Dynamic Test Flow",
    description: "Flow with a single dynamic step",
    steps: [
      {
        id: "dyn1",
        name: "Dynamic Step",
        agent_role: "agent1",
        execution_mode: FlowStepExecutionMode.DYNAMIC,
        permitted_tools: [
          McpToolName.READ_FILE,
          McpToolName.LIST_DIRECTORY,
          McpToolName.SEARCH_FILES,
        ],
        input: { source: FlowInputSource.REQUEST },
        dependsOn: [] as string[],
      },
    ],
    output: { from: "dyn1", format: FlowOutputFormat.MARKDOWN },
  };
}

class RecordingMcpClient implements IMcpClient, IToolManifestResolver {
  getAvailableToolNames(): McpToolName[] {
    return [McpToolName.READ_FILE, McpToolName.LIST_DIRECTORY, McpToolName.SEARCH_FILES];
  }

  getToolDefinitions(tools: McpToolName[]) {
    return tools.map((t) => ({
      name: t,
      description: `Description of ${t}`,
      inputSchema: { type: "object" as const, properties: {} },
    }));
  }

  requiresHumanApproval(_tool: McpToolName): boolean {
    return false;
  }

  callTool(tool: McpToolName, _args: ToolArgs): Promise<string> {
    return Promise.resolve(`Result from ${tool}`);
  }
}

Deno.test(
  "[step163.6][dynamic-model] FlowRunner with modelResolver + mcpClient: the lazily-built DynamicStepExecutor " +
    "reaches the step handler — a dynamic-mode step completes via DynamicStepExecutor",
  async () => {
    const { db, tempDir, cleanup } = await initTestDbService();
    try {
      const recordingsDir = join(tempDir, "recordings");
      Deno.mkdirSync(recordingsDir, { recursive: true });
      Deno.writeTextFileSync(
        join(recordingsDir, "react-complete.json"),
        JSON.stringify(REACT_COMPLETE_FIXTURE, null, 2),
      );
      const dynamicConfig = createMockConfig(tempDir, {
        ai: {
          provider: "mock",
          model: "test",
          timeout_ms: 30000,
          mock: { strategy: MockStrategy.RECORDED, fixtures_dir: recordingsDir },
        },
      });
      writeAgentIdentity(tempDir);

      let resolvedIntent: IModelIntent | undefined;
      const mockResolver = {
        resolve: (intent: IModelIntent) => {
          resolvedIntent = intent;
          return Promise.resolve({ provider: "mock", model: "mock-model", attempt: 1 });
        },
      } as ModelResolver;

      const events: string[] = [];
      const capturingLogger: IFlowEventLogger = {
        log: (event: string) => {
          events.push(event);
        },
      };

      const runner = new FlowRunner({
        agentExecutor: new MockAgentRunner(),
        eventLogger: capturingLogger,
        config: dynamicConfig,
        db,
        modelResolver: mockResolver,
        mcpClient: new RecordingMcpClient(),
      });

      const flow = createDynamicFlow();
      await runner.execute(flow as IFlow, { userPrompt: "test" });

      assertExists(resolvedIntent, "the dynamic model must be lazily resolved via ModelResolver");
      assertExists(
        events.find((e) => e === "dynamic_step_completed"),
        "dynamic_step_completed is emitted only by DynamicStepExecutor; its absence means the lazily-built " +
          "executor never reached the step handler and the dynamic step fell through to the static path " +
          "(Phase 163 Step 6 flow_runner.ts propagation fix)",
      );
    } finally {
      await cleanup();
    }
  },
);

// Per-call options reach the dynamic ReAct generate()

class CapturingLlm implements ILlmClient {
  lastOptions: IModelCallOptions | undefined;
  reasonNextAction(params: {
    agent_role: IBlueprintFrontmatter;
    stepObjective: string;
    accumulatedContext: string;
    availableTools: Array<{ name: string; description: string; inputSchema: Record<string, JSONValue> }>;
    iteration: number;
    maxIterations: number;
    options?: IModelCallOptions;
  }): Promise<{ done: boolean; tool?: McpToolName; args?: ToolArgs; output?: string }> {
    this.lastOptions = params.options;
    return Promise.resolve({ done: true, output: "complete" });
  }
}

/** Noop activity journal satisfying IActivityJournal. */
const noopJournal = { log: (_entry: JournalEntry): Promise<void> => Promise.resolve() };

function buildDynamicStep(): IFlowStep {
  return FlowStepSchema.parse({
    id: "dyn-gap9",
    name: "Dynamic Step",
    agent_role: "agent1",
    execution_mode: FlowStepExecutionMode.DYNAMIC,
    permitted_tools: [McpToolName.READ_FILE, McpToolName.LIST_DIRECTORY],
    input: { source: FlowInputSource.REQUEST },
    dependsOn: [],
    retry: { maxAttempts: 1, backoffMs: 0 },
  }) as IFlowStep;
}

Deno.test("[132.26][GAP-9] DynamicStepExecutor forwards resolved call options to every ReAct generate", async () => {
  const llm = new CapturingLlm();
  const executor = new DynamicStepExecutor(
    new RecordingMcpClient(),
    llm,
    noopJournal as never,
    undefined,
    undefined,
    undefined,
    new Set([McpToolName.READ_FILE, McpToolName.LIST_DIRECTORY]),
    new Set(),
    { thinking: true, effort: "high", max_tokens: 8192 },
  );

  const agent_role: IBlueprintFrontmatter = {
    name: "agent1",
    model: "",
    description: "test",
  } as IBlueprintFrontmatter;
  const opts: IDynamicStepExecutorOptions = { traceId: "t-gap9", maxIterations: 3 };

  const result = await executor.execute(buildDynamicStep(), agent_role, "probe", opts);

  assertEquals(result.completed, true);
  assertEquals(llm.lastOptions?.thinking, true);
  assertEquals(llm.lastOptions?.effort, "high");
  assertEquals(llm.lastOptions?.max_tokens, 8192);
});

Deno.test("[132.26][GAP-9] DynamicStepExecutor without call options stays backward compatible", async () => {
  const llm = new CapturingLlm();
  const executor = new DynamicStepExecutor(
    new RecordingMcpClient(),
    llm,
    noopJournal as never,
    undefined,
    undefined,
    undefined,
    new Set([McpToolName.READ_FILE, McpToolName.LIST_DIRECTORY]),
    new Set(),
  );

  const agent_role: IBlueprintFrontmatter = {
    name: "agent1",
    model: "",
    description: "test",
  } as IBlueprintFrontmatter;
  const opts: IDynamicStepExecutorOptions = { traceId: "t-gap9b", maxIterations: 3 };

  await executor.execute(buildDynamicStep(), agent_role, "probe", opts);

  assertEquals(llm.lastOptions, undefined);
});
