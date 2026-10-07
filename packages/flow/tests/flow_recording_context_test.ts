/**
 * @module FlowRecordingContextTest
 * @path packages/flow/tests/flow_recording_context_test.ts
 * @description Verifies run-local fixture call-site lanes and their forwarding to provider boundaries.
 * @architectural-layer Test
 * @dependencies [@exaix/flow, @exaix/execution, @exaix/ai]
 * @related-files [packages/flow/src/contracts/flow_recording_context.ts, packages/execution/src/agent_runner.ts, packages/ai/src/recording_lane_provider.ts]
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { FlowStepExecutionMode } from "@exaix/core";
import type { IRecordedCallSite } from "@exaix/core/types";
import { AgentRunner, type IBlueprint, type IParsedRequest } from "@exaix/execution";
import {
  type ICallSite,
  type ILlmClient,
  type IModelOptions,
  type IModelProvider,
  LlmClient,
  RecordingLaneProvider,
} from "@exaix/ai";
import type { IGenerateResult } from "@exaix/ai/providers";
import { MockProvider } from "@exaix/ai/providers.ts";
import { DYNAMIC_MODE_APPROVAL_TOOLS, DYNAMIC_MODE_TOOLS, McpToolName } from "@exaix/mcp";
import { FlowStepSchema } from "@exaix/schemas/flow.ts";
import { BlueprintFrontmatterSchema } from "@exaix/schemas/blueprint.ts";
import {
  AgentComposerAdapter,
  createFlowRecordingContext,
  delegateReviewLane,
  dynamicLane,
  DynamicStepExecutor,
  judgeLane,
  reactLane,
  voterLane,
} from "@exaix/flow";
import type { IRunner } from "@exaix/flow/agent_composer_adapter.ts";

const BLUEPRINT: IBlueprint = { systemPrompt: "system prompt" };
const SCENARIO = { scenarioId: "self-correcting-implementation", stepId: "submit" };

function answer(providerId: string): IGenerateResult {
  return {
    content: "<thought>ok</thought><content>ok</content>",
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    model: "mock-model",
    provider: providerId,
  };
}

function capturingProvider(sites: (ICallSite | undefined)[], delayMs = 0): IModelProvider {
  return {
    id: "capture",
    async generate(_prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
      sites.push(options?.callSite);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return answer("capture");
    },
  };
}

function enabledContext() {
  const context = createFlowRecordingContext({ ...SCENARIO, enabled: true });
  assert(context, "an opted-in scenario run must allocate a recording context");
  return context;
}

Deno.test("[recording] caller lanes use the documented suffixes", () => {
  assertEquals(judgeLane("quality-gate"), "quality-gate--judge");
  assertEquals(reactLane("implement"), "implement--react");
  assertEquals(dynamicLane("explore"), "explore--dynamic");
  assertEquals(voterLane("vote", 2), "vote--voter-2");
  assertEquals(delegateReviewLane("next-steps"), "next-steps--delegate-review");
});

Deno.test("[recording] a context exists only for an opted-in scenario run", () => {
  assertEquals(createFlowRecordingContext({ ...SCENARIO, enabled: false }), undefined);
  assertEquals(createFlowRecordingContext({ scenarioId: undefined, stepId: "submit", enabled: true }), undefined);
  assertEquals(createFlowRecordingContext({ scenarioId: "s", stepId: undefined, enabled: true }), undefined);
});

Deno.test("[recording] a lane repeats its index until consumed, and lanes advance independently", () => {
  const context = enabledContext();
  const implement = context.lane("implement");
  const first = implement.current();
  assertEquals(first, { ...SCENARIO, flowStepId: "implement", callIndex: 0 });
  assertEquals(implement.current().callIndex, 0);
  implement.consume(first);
  assertEquals(implement.current().callIndex, 1);
  assertEquals(context.lane("implement").current().callIndex, 1, "one lane object per run and lane id");
  assertEquals(context.lane(reactLane("implement")).current().callIndex, 0);
});

Deno.test("[recording] two concurrent runs of one scenario keep independent indexes on one shared runner", async () => {
  const sites: (ICallSite | undefined)[] = [];
  const runner = new AgentRunner(capturingProvider(sites, 5), { disableRetry: true });
  const runA = enabledContext();
  const runB = enabledContext();
  const request = (lane: ReturnType<typeof runA.lane>): IParsedRequest => ({
    userPrompt: "task",
    context: {},
    ...SCENARIO,
    flowStepId: "implement",
    recordingLane: lane,
  });
  const twice = async (lane: ReturnType<typeof runA.lane>) => {
    await runner.run(BLUEPRINT, request(lane), undefined);
    await runner.run(BLUEPRINT, request(lane), undefined);
  };
  await Promise.all([twice(runA.lane("implement")), twice(runB.lane("implement"))]);

  assertEquals(sites.map((site) => site?.callIndex).sort(), [0, 0, 1, 1]);
  assertEquals(runA.lane("implement").current().callIndex, 2);
  assertEquals(runB.lane("implement").current().callIndex, 2);

  sites.length = 0;
  await runner.run(BLUEPRINT, { userPrompt: "task", context: {}, ...SCENARIO, flowStepId: "implement" }, undefined);
  assertEquals(sites[0]?.callIndex, 0, "explicit lanes must not advance the runner's legacy counter");
});

Deno.test("[recording] internal provider retries of one preallocated direct call keep its index", async () => {
  const sites: (ICallSite | undefined)[] = [];
  let attempts = 0;
  const provider: IModelProvider = {
    id: "flaky",
    generate(_prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
      sites.push(options?.callSite);
      attempts++;
      if (attempts === 1) return Promise.reject(new Error("rate limit exceeded, please retry"));
      return Promise.resolve(answer("flaky"));
    },
  };
  const runner = new AgentRunner(provider, {
    retryPolicy: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 1, jitterFactor: 0 },
  });
  const lane = enabledContext().lane("plan");
  await runner.run(
    BLUEPRINT,
    { userPrompt: "task", context: {}, ...SCENARIO, flowStepId: "plan", recordingLane: lane },
    undefined,
  );

  assertEquals(sites.map((site) => site?.callIndex), [0, 0]);
  assertEquals(sites[0]?.flowStepId, "plan");
  assertEquals(lane.current().callIndex, 1, "only the consumed response advances the run allocator");
});

Deno.test("[recording] the strategy provider boundary stamps each turn and consumes only answered turns", async () => {
  const sites: (ICallSite | undefined)[] = [];
  let calls = 0;
  const inner: IModelProvider = {
    id: "inner",
    callCapabilities: { supportsToolChoice: false } as IModelProvider["callCapabilities"],
    generate(_prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
      sites.push(options?.callSite);
      calls++;
      if (calls === 1) return Promise.reject(new Error("transport failure"));
      return Promise.resolve(answer("inner"));
    },
  };
  const lane = enabledContext().lane(reactLane("implement"));
  const provider = new RecordingLaneProvider(inner, lane);
  assertEquals(provider.id, "inner");
  assertEquals(provider.callCapabilities, inner.callCapabilities);

  await assertRejects(() => provider.generate("turn", { traceId: "trace-1" }));
  await provider.generate("turn", { traceId: "trace-1" });
  await provider.generate("next turn", { traceId: "trace-1" });

  assertEquals(sites.map((site) => site?.callIndex), [0, 0, 1]);
  assertEquals(sites[2]?.flowStepId, "implement--react");
});

Deno.test("[recording] strategy routing selects a lane only for provider-backed strategies", () => {
  const context = enabledContext();
  assertEquals(
    AgentComposerAdapter.strategyRecordingLane(context, "implement", "react")?.current().flowStepId,
    "implement--react",
  );
  assertEquals(AgentComposerAdapter.strategyRecordingLane(context, "probe", "mcp")?.current().flowStepId, "probe--mcp");
  assertEquals(AgentComposerAdapter.strategyRecordingLane(context, "delegate", "cli_delegate"), undefined);
  assertEquals(AgentComposerAdapter.strategyRecordingLane(undefined, "implement", "react"), undefined);
});

Deno.test("[recording] a direct agent call receives its run lane through the adapter", async () => {
  const received: Array<Parameters<IRunner["run"]>[1]> = [];
  const runner = new AgentRunner(new MockProvider("<thought>ok</thought><content>ok</content>"), {
    disableRetry: true,
  });
  const run = runner.run.bind(runner);
  runner.run = (blueprint, request, skills) => {
    received.push(request);
    return run(blueprint, request, skills);
  };
  const adapter = new AgentComposerAdapter(runner, new URL("../../../Blueprints/Agents", import.meta.url).pathname);
  const recording = enabledContext();
  await adapter.run("senior-coder", { userPrompt: "plan", context: {}, ...SCENARIO, flowStepId: "plan", recording });
  await adapter.run("software-architect", {
    userPrompt: "vote",
    context: {},
    ...SCENARIO,
    flowStepId: "vote",
    recording,
    recordingLaneId: voterLane("vote", 1),
  });

  assertEquals(received[0].recordingLane?.current().flowStepId, "plan");
  assertEquals(received[0].recordingLane?.current().callIndex, 1);
  assertEquals(received[1].flowStepId, "vote", "binding resolution keeps the original flow step id");
  assertEquals(received[1].recordingLane?.current().flowStepId, "vote--voter-1");
});

Deno.test("[recording] DYNAMIC reasoning sends one lane call site per consumed iteration", async () => {
  const sites: (IRecordedCallSite | undefined)[] = [];
  const decisions = [
    { done: false, tool: McpToolName.READ_FILE, args: { path: "main.ts" } },
    { done: true, output: "summary" },
  ];
  const llmClient: ILlmClient = {
    createNativeConversation: () => Promise.resolve({ initialPrompt: "", turns: [] }),
    reasonNextAction: (params) => {
      sites.push(params.callSite);
      return Promise.resolve(decisions.shift()!);
    },
  } as ILlmClient;
  const mcpClient = {
    callTool: () => Promise.resolve("console.log('hello');"),
    getToolDefinitions: (tools: McpToolName[]) =>
      tools.map((name) => ({ name, description: name, inputSchema: { type: "object" as const, properties: {} } })),
    requiresHumanApproval: () => false,
  };
  const executor = new DynamicStepExecutor(
    mcpClient as never,
    llmClient,
    { log: () => Promise.resolve() },
    undefined,
    undefined,
    undefined,
    DYNAMIC_MODE_TOOLS,
    DYNAMIC_MODE_APPROVAL_TOOLS,
  );
  const step = FlowStepSchema.parse({
    id: "explore",
    name: "Explore",
    agent_role: "code-analyst",
    execution_mode: FlowStepExecutionMode.DYNAMIC,
    permitted_tools: [McpToolName.READ_FILE],
  });
  const role = BlueprintFrontmatterSchema.parse({
    agent_role: "code-analyst",
    name: "Code Analyst",
    model: "mock:model",
    created: new Date().toISOString(),
    created_by: "test",
    permitted_tools: [McpToolName.READ_FILE],
  });
  const lane = enabledContext().lane(dynamicLane("explore"));
  await executor.execute(step, role, "Explore", { traceId: "trace-1", recordingLane: lane });

  assertEquals(sites.map((site) => site?.flowStepId), ["explore--dynamic", "explore--dynamic"]);
  assertEquals(sites.map((site) => site?.callIndex), [0, 1]);
  assertEquals(lane.current().callIndex, 2);
});

Deno.test("[recording] the DYNAMIC model client forwards the lane call site to the provider", async () => {
  const sites: (ICallSite | undefined)[] = [];
  const provider: IModelProvider = {
    id: "dynamic-capture",
    generate(_prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
      sites.push(options?.callSite);
      return Promise.resolve({
        ...answer("dynamic-capture"),
        content: JSON.stringify({ reasoning: "done", action: { type: "complete", output: "x" } }),
      });
    },
  };
  const callSite = enabledContext().lane(dynamicLane("explore")).current();
  await new LlmClient(undefined, provider).reasonNextAction({
    agent_role: BlueprintFrontmatterSchema.parse({
      agent_role: "code-analyst",
      name: "Code Analyst",
      created: new Date().toISOString(),
      created_by: "test",
    }),
    stepObjective: "Explore",
    accumulatedContext: "",
    availableTools: [],
    iteration: 1,
    maxIterations: 2,
    traceId: "trace-1",
    callSite,
  });
  assertEquals(sites, [callSite]);
});
