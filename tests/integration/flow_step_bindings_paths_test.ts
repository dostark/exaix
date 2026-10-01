/**
 * @module FlowStepBindingsPathsTest
 * @path tests/integration/flow_step_bindings_paths_test.ts
 * @description Step-3 integration coverage: strategy (API and CLI), DYNAMIC and gate-judge
 *   paths honor per-step model bindings through the production FlowRunner. The bound
 *   provider or CLI tool is the one that runs the step or gate.
 * @architectural-layer Services
 * @related-files [packages/flow/src/agent_composer_adapter.ts, packages/flow/src/flow_runner.ts, apps/daemon/src/judge_agent_runner.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { EventLogger } from "@exaix/core/logger";
import { PortalPermissionsService } from "@exaix/portal";
import { type IRunCliDelegateProcess, StrategyRegistry } from "@exaix/execution";
import {
  ExecutionStrategyName,
  FlowInputSource,
  FlowOutputFormat,
  FlowStepExecutionMode,
  FlowStepType,
  PricingTier,
  ProviderCostTier,
} from "@exaix/core";
import { SESSION_BIN_CODEX } from "@exaix/core/types";
import {
  type IModelOptions,
  type IModelProvider,
  type IResolvedProviderOptions,
  ModelBindingService,
  ProviderRegistry,
} from "@exaix/ai";
import type { IProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IFlow } from "@exaix/schemas/flow.ts";
import { AgentComposerAdapter, FlowRunner, GateEvaluator, JudgeEvaluator, PlanContextResolver } from "@exaix/flow";
import type { IFlowEventLogger, IFlowStepRequest } from "@exaix/flow";
import { JudgeAgentRunner } from "../../apps/daemon/src/judge_agent_runner.ts";
import { ConfigSchema, FlowSchema, getDefaultModels } from "@exaix/schemas";
import type { Config } from "@exaix/schemas/config.ts";
import { createMockConfig, createMockEventLogger, initTestDbService } from "@exaix/testing";
import type { JSONValue } from "@exaix/core";
import type { IToolManifestResolver } from "@exaix/core/types";
import type { IMcpClient, McpToolName } from "@exaix/mcp";
import type { ToolArgs } from "@exaix/ai";

/** In-memory MCP client so a real DYNAMIC flow run never touches the network. */
class RecordingMcpClient implements IMcpClient, IToolManifestResolver {
  getAvailableToolNames(): McpToolName[] {
    return [] as McpToolName[];
  }
  getToolDefinitions(
    _tools: McpToolName[],
  ): Array<{ name: string; description: string; inputSchema: { type: string; properties: Record<string, never> } }> {
    return [];
  }
  requiresHumanApproval(_tool: McpToolName): boolean {
    return false;
  }
  callTool(_tool: McpToolName, _args: ToolArgs): Promise<string> {
    return Promise.resolve("ok");
  }
}

class MockProviderFactory implements IProviderFactory {
  readonly calls: Array<{ model: string; options?: IModelOptions }> = [];
  readonly creates: Array<{ model: string }> = [];
  constructor(private readonly content: (model: string) => string) {}

  create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const model = options.model;
    this.creates.push({ model });
    return Promise.resolve({
      id: `mock-${model}`,
      callCapabilities: { profile: "mock", supportedEffortTiers: ["low", "medium", "high"], supportsThinking: true },
      generate: (_prompt: string, generateOptions?: IModelOptions): Promise<IGenerateResult> => {
        this.calls.push({ model, options: generateOptions });
        return Promise.resolve({
          content: this.content(model),
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model,
          provider: "mock",
          cost_usd: 0,
        });
      },
    });
  }
}

/** Judge response body the real JudgeEvaluator parses into a passing result. */
const JUDGE_OK = JSON.stringify({
  overallScore: 0.9,
  criteriaScores: {
    code_correctness: { name: "code_correctness", score: 0.9, reasoning: "ok", passed: true },
  },
  pass: true,
  feedback: "ok",
});

function content(model: string): string {
  return `<thought>ok</thought><content>${model}</content>`;
}

function registerFactory(name: string, factory: MockProviderFactory): void {
  ProviderRegistry.registerWithMetadata(name, factory, {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
}

class FlowLog implements IFlowEventLogger {
  readonly actions: string[] = [];
  log(action: string, _payload: Record<string, JSONValue | undefined>): void {
    this.actions.push(action);
  }
}

function configFor(root: string): Config {
  return ConfigSchema.parse({
    system: { root },
    paths: {},
    ai: { provider: "mock", model: "boot" },
    catalog: {
      models: {
        "mock/alpha": { model_provider: "mock" },
        "mock/beta": { model_provider: "mock" },
      },
      services: {
        alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
        beta: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/beta": "beta" } },
      },
    },
  });
}

async function writeBlueprints(root: string, roles: string[]): Promise<string> {
  const blueprints = join(root, "Blueprints", "Agents");
  await Deno.mkdir(blueprints, { recursive: true });
  for (const role of roles) {
    await Deno.writeTextFile(
      join(blueprints, `${role}.md`),
      `---\nagent_role: ${role}\nmodel: mock:boot\n---\nYou are ${role}.`,
    );
  }
  return blueprints;
}

type FlowStepOverride = Record<string, JSONValue | undefined>;

function flowWith(step: FlowStepOverride): IFlow {
  return FlowSchema.parse({
    id: "research",
    name: "Research",
    description: "bindings paths",
    version: "1.0.0",
    steps: [{
      id: "s1",
      name: "Step 1",
      agent_role: "builder",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST },
      ...step,
    }],
    output: { from: "s1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
  });
}

Deno.test("cli-delegate bindings preflight as session-tool targets and never construct a provider", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const blueprints = await writeBlueprints(tempDir, ["builder"]);
    const config = ConfigSchema.parse({
      ...configFor(tempDir),
      catalog: {
        models: {},
        services: {
          opencode: {
            adapter: "cli-delegate",
            transport: "local",
            interface: "cli",
            tool: "opencode",
            serves: { "*": "{name}" },
          },
        },
      },
      bindings: {
        "flow:research/step:s1": { service: "opencode", service_model_id: "opencode/model-x" },
      },
    });
    void blueprints;
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const flow = flowWith({ strategy: ExecutionStrategyName.CLI_DELEGATE });
    const snapshot = await service.snapshotForRun(flow, { traceId: "t", requestId: "r" });
    const target = await service.providerFor(snapshot, {
      flowId: "research",
      stepId: "s1",
      agentRole: "builder",
      kind: "agent",
      strategy: ExecutionStrategyName.CLI_DELEGATE,
      nativeTools: false,
    });
    assertEquals(target!.kind, "session-tool");
    if (target!.kind === "session-tool") {
      assertEquals(target!.tool, "opencode");
      assertEquals(target!.binding.service_model_id, "opencode/model-x");
    }
  } finally {
    await cleanup();
  }
});

Deno.test("a strategy: cli_delegate step bound to service opencode launches the opencode tool with the bound model", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const config: Config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: {
        models: {},
        services: {
          opencode: {
            adapter: "cli-delegate",
            transport: "local",
            interface: "cli",
            tool: "opencode",
            serves: { "*": "{name}" },
          },
        },
      },
      bindings: {
        "flow:research/step:s1": { service: "opencode", service_model_id: "opencode/model-x" },
      },
    });
    const blueprints = await writeBlueprints(tempDir, ["builder"]);
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });

    // Capture the tool + model the strategy would launch, using a fake `run` so no real
    // subprocess executes. Registering a REAL CliDelegateStrategy through the adapter's
    // test-only escape hatch proves the binding values reach the delegate launch.
    const launched: Array<{ bin: string; args: string[] }> = [];
    const fakeRun = (
      bin: string,
      args: string[],
      _opts: Parameters<IRunCliDelegateProcess>[2],
    ): Promise<{ code: number; stdout: string; stderr: string }> => {
      launched.push({ bin, args });
      return Promise.resolve({ code: 0, stdout: JSON.stringify({ sessionID: "s1" }), stderr: "" });
    };

    const adapter = new AgentComposerAdapter(
      { run: () => Promise.reject(new Error("strategy path must not run the declared runner")) } as never,
      blueprints,
      {
        config,
        db,
        logger: new EventLogger({ db }) as never,
        permissions: new PortalPermissionsService(config.portals!) as never,
        provider: undefined,
        cliDelegateRun: fakeRun,
      } as never,
      service,
    );
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
    const result = await runner.execute(flowWith({ strategy: ExecutionStrategyName.CLI_DELEGATE }), {
      userPrompt: "do it",
      portal: config.portals![0].alias,
    });
    assertEquals(result.success, true);
    const session = launched[0];
    assertEquals(session?.bin, "opencode");
    const modelIndex = session?.args.indexOf("--model") ?? -1;
    assertEquals(modelIndex !== -1, true, `expected --model in args: ${session?.args}`);
    assertEquals(session?.args[modelIndex + 1], "opencode/model-x");
  } finally {
    await cleanup();
  }
});

Deno.test("a bound codex delegate invokes the Codex binary and a bound delegate works with cli_delegate.enabled=false", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const config: Config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: {
        models: {},
        services: {
          codex: {
            adapter: "cli-delegate",
            transport: "local",
            interface: "cli",
            tool: "codex",
            serves: { "*": "{name}" },
          },
        },
      },
      bindings: {
        "flow:research/step:s1": { service: "codex", service_model_id: "codex/model-x" },
      },
    });
    const blueprints = await writeBlueprints(tempDir, ["builder"]);
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });

    const launched: Array<{ bin: string; args: string[] }> = [];
    const fakeRun = (
      bin: string,
      args: string[],
      _opts: Parameters<IRunCliDelegateProcess>[2],
    ): Promise<{ code: number; stdout: string; stderr: string }> => {
      launched.push({ bin, args });
      return Promise.resolve({ code: 0, stdout: JSON.stringify({ sessionID: "s1" }), stderr: "" });
    };

    const adapter = new AgentComposerAdapter(
      { run: () => Promise.reject(new Error("strategy path must not run the declared runner")) } as never,
      blueprints,
      {
        config,
        db,
        logger: new EventLogger({ db }) as never,
        permissions: new PortalPermissionsService(config.portals!) as never,
        provider: undefined,
        cliDelegateRun: fakeRun,
      } as never,
      service,
    );
    // cli_delegate.enabled is false here (createMockConfig default).
    // The bound delegate still registers and launches the Codex binary.
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
    const result = await runner.execute(flowWith({ strategy: ExecutionStrategyName.CLI_DELEGATE }), {
      userPrompt: "do it",
      portal: config.portals![0].alias,
    });
    assertEquals(result.success, true);
    const session = launched[0];
    assertEquals(session?.bin, SESSION_BIN_CODEX);
    const modelIndex = session?.args.indexOf("--model") ?? -1;
    assertEquals(modelIndex !== -1, true, `expected --model in args: ${session?.args}`);
    assertEquals(session?.args[modelIndex + 1], "codex/model-x");
  } finally {
    await cleanup();
  }
});

Deno.test("an incompatible bound cli-delegate tool fails before launch", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const config: Config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: {
        models: {},
        services: {
          // A cli-delegate service whose tool maps to no binary.
          // Cursor is not a supported SessionTool.
          // The strategy refuses to build before any subprocess.
          cursor: {
            adapter: "cli-delegate",
            transport: "local",
            interface: "cli",
            tool: "cursor" as never,
            serves: { "*": "{name}" },
          },
        },
      },
      bindings: {
        "flow:research/step:s1": { service: "cursor", service_model_id: "cursor/model-x" },
      },
    });
    const blueprints = await writeBlueprints(tempDir, ["builder"]);
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const fakeRun = (
      _bin: string,
      _args: string[],
      _opts: Parameters<IRunCliDelegateProcess>[2],
    ): Promise<{ code: number; stdout: string; stderr: string }> => {
      throw new Error("must never launch a subprocess");
    };
    const adapter = new AgentComposerAdapter(
      { run: () => Promise.reject(new Error("strategy path must not run the declared runner")) } as never,
      blueprints,
      {
        config,
        db,
        logger: new EventLogger({ db }) as never,
        permissions: new PortalPermissionsService(config.portals!) as never,
        provider: undefined,
        cliDelegateRun: fakeRun,
      } as never,
      service,
    );
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
    await assertRejects(
      () =>
        runner.execute(flowWith({ strategy: ExecutionStrategyName.CLI_DELEGATE }), {
          userPrompt: "do it",
          portal: config.portals![0].alias,
        }),
      Error,
      "Unsupported cli-delegate tool",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("a strategy: react step runs on its bound provider", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const factory = new MockProviderFactory(content);
  registerFactory("mock", factory);
  try {
    const canonicalMock = `mock/${getDefaultModels().mock}`;
    const config: Config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: {
        models: {},
        services: {
          alpha: { adapter: "mock", transport: "local", interface: "api", serves: { [canonicalMock]: "alpha" } },
        },
      },
      bindings: {
        "flow:research/step:s1": { service: "alpha", model: canonicalMock, effort: "high", thinking: true },
      },
    });
    const blueprints = await writeBlueprints(tempDir, ["builder"]);
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });

    // Spy REACT strategy proves the step routes through runWithStrategy.
    // The bound provider's construction is proven during preflight.
    const receivedOptions: Array<{ effort?: string; thinking?: boolean | string }> = [];
    const strategyRegistry = new StrategyRegistry();
    strategyRegistry.register({
      name: ExecutionStrategyName.REACT,
      execute: (_blueprint, _context, options) => {
        receivedOptions.push({ effort: options.effort, thinking: options.thinking });
        return Promise.resolve({
          branch: "feat/step",
          commit_sha: "0".repeat(40),
          files_changed: [],
          description: "react-bound",
          tool_calls: 0,
          execution_time_ms: 10,
        });
      },
    });

    const adapter = new AgentComposerAdapter(
      { run: () => Promise.reject(new Error("strategy path must not run the declared runner")) } as never,
      blueprints,
      {
        config,
        db,
        logger: new EventLogger({ db }) as never,
        permissions: new PortalPermissionsService(config.portals!) as never,
        provider: undefined,
        strategyRegistry,
      } as never,
      service,
    );
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
    const result = await runner.execute(flowWith({ strategy: ExecutionStrategyName.REACT }), {
      userPrompt: "do it",
      portal: config.portals![0].alias,
    });

    assertEquals(result.success, true);
    // The bound service's provider was constructed during snapshot preflight and the binding
    // was resolved (binding.resolved event for this step).
    const resolved = logger.events.filter((event) => event.action === "binding.resolved");
    assertEquals(resolved.length, 1);
    assertEquals((resolved[0].payload as { service?: string }).service, "alpha");
    // The snapshot's effective effort/thinking reached the strategy execution options.
    assertEquals(receivedOptions[0]?.effort, "high");
    assertEquals(receivedOptions[0]?.thinking, true);
  } finally {
    await cleanup();
  }
});

Deno.test("a gate step bound through flow:/step: grades on the bound provider; an unbound gate uses the boot provider", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const factory = new MockProviderFactory((_model) => JUDGE_OK);
  registerFactory("mock", factory);
  try {
    const config: Config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: {
        models: { "mock/alpha": { model_provider: "mock" } },
        services: {
          alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
        },
      },
      bindings: {
        "flow:research/step:gate1": { service: "alpha", model: "mock/alpha" },
      },
    });
    void await writeBlueprints(tempDir, ["reviewer"]);
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const nullRunner = {
      run: () => Promise.resolve({ content: JUDGE_OK }),
    } as never;
    const judge = new JudgeEvaluator(new JudgeAgentRunner(nullRunner, service));
    const gateEvaluator = new GateEvaluator(judge);
    const flow = FlowSchema.parse({
      id: "research",
      name: "Research",
      description: "gate",
      version: "1.0.0",
      steps: [{
        id: "gate1",
        name: "Gate 1",
        type: FlowStepType.GATE,
        agent_role: "reviewer",
        evaluate: {
          agent_role: "reviewer",
          criteria: ["CODE_CORRECTNESS"],
          threshold: 0.8,
          onFail: "halt",
          maxRetries: 3,
          includeRequestCriteria: false,
        },
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST },
      }],
      output: { from: "gate1", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
    });
    const runner = new FlowRunner({
      agentExecutor: { run: () => Promise.resolve({ content: "", raw: "", thought: "" }) } as never,
      eventLogger: new FlowLog(),
      gateEvaluator,
      bindingService: service,
    });
    const result = await runner.execute(flow, { userPrompt: "grade this", traceId: crypto.randomUUID() });
    assertEquals(result.success, true);
    // The bound judge provider ran the grade (its generate was called with the alpha model).
    assertEquals(factory.calls.length, 1);
    assertEquals(factory.calls[0]?.model, "alpha");
  } finally {
    await cleanup();
  }
});

Deno.test("an unbound gate step uses the boot judge provider and records no binding.resolved", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const config: Config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: { models: {}, services: {} },
    });
    const _blueprints = await writeBlueprints(tempDir, ["reviewer"]);
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    let bootCalls = 0;
    const bootJudge = {
      generate: () => {
        bootCalls++;
        return Promise.resolve({
          content: JUDGE_OK,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: "boot",
          provider: "mock",
          cost_usd: 0,
        });
      },
    } as never;
    const judge = new JudgeEvaluator(new JudgeAgentRunner(bootJudge, service));
    const gateEvaluator = new GateEvaluator(judge);
    const flow = FlowSchema.parse({
      id: "research",
      name: "Research",
      description: "gate",
      version: "1.0.0",
      steps: [{
        id: "gate1",
        name: "Gate 1",
        type: FlowStepType.GATE,
        agent_role: "reviewer",
        evaluate: {
          agent_role: "reviewer",
          criteria: ["CODE_CORRECTNESS"],
          threshold: 0.8,
          onFail: "halt",
          maxRetries: 3,
          includeRequestCriteria: false,
        },
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST },
      }],
      output: { from: "gate1", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
    });
    const runner = new FlowRunner({
      agentExecutor: { run: () => Promise.resolve({ content: "", raw: "", thought: "" }) } as never,
      eventLogger: new FlowLog(),
      gateEvaluator,
      bindingService: service,
    });
    const result = await runner.execute(flow, { userPrompt: "grade this", traceId: crypto.randomUUID() });
    assertEquals(result.success, true);
    assertEquals(bootCalls, 1);
    assertEquals(logger.events.filter((event) => event.action === "binding.resolved").length, 0);
  } finally {
    await cleanup();
  }
});
Deno.test("a gate using cli-delegate is refused with interface_unsupported while a generate-backed claude-cli gate runs on that provider", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const factory = new MockProviderFactory((_model) => JUDGE_OK);
  registerFactory("mock", factory);
  // The generate-backed CLI provider adapter is a registered factory name.
  // Registering the mock factory under it lets the gate run without a real binary.
  registerFactory("claude-cli", factory);
  try {
    const config: Config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: {
        models: { "mock/alpha": { model_provider: "mock" } },
        services: {
          alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
          opencode: {
            adapter: "cli-delegate",
            transport: "local",
            interface: "cli",
            tool: "opencode",
            serves: { "*": "{name}" },
          },
          claude: {
            adapter: "claude-cli",
            transport: "local",
            interface: "cli",
            serves: { "*": "{name}" },
          },
        },
      },
      bindings: {
        "flow:research/step:gate1": { service: "opencode", service_model_id: "opencode/model-x" },
      },
    });
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const judge = new JudgeEvaluator({
      run: () => Promise.resolve({ content: JUDGE_OK }),
    } as never);
    const gateEvaluator = new GateEvaluator(judge);
    void gateEvaluator;
    const flow = FlowSchema.parse({
      id: "research",
      name: "Research",
      description: "gate",
      version: "1.0.0",
      steps: [{
        id: "gate1",
        name: "Gate 1",
        type: FlowStepType.GATE,
        agent_role: "reviewer",
        evaluate: {
          agent_role: "reviewer",
          criteria: ["CODE_CORRECTNESS"],
          threshold: 0.8,
          onFail: "halt",
          maxRetries: 3,
          includeRequestCriteria: false,
        },
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST },
      }],
      output: { from: "gate1", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
    });
    await assertRejects(
      () => service.snapshotForRun(flow, { traceId: crypto.randomUUID(), requestId: "r" }),
      Error,
      "interface_unsupported",
    );
    assertEquals(factory.calls.length, 0);

    // A generate-backed claude-cli service is a provider.
    // It is valid for a gate and runs on the bound provider.
    const cliConfig: Config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: {
        models: { "mock/alpha": { model_provider: "mock" } },
        services: {
          claude: { adapter: "claude-cli", transport: "local", interface: "cli", serves: { "mock/alpha": "claude" } },
        },
      },
      bindings: { "flow:research/step:gate1": { service: "claude", model: "mock/alpha" } },
    });
    const cliService = new ModelBindingService({
      configSource: { get: () => cliConfig },
      logger: createMockEventLogger(),
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const nullRunner = { run: () => Promise.resolve({ content: JUDGE_OK }) } as never;
    const cliJudge = new JudgeEvaluator(new JudgeAgentRunner(nullRunner, cliService));
    const cliGateEvaluator = new GateEvaluator(cliJudge);
    const cliRunner = new FlowRunner({
      agentExecutor: { run: () => Promise.resolve({ content: "", raw: "", thought: "" }) } as never,
      eventLogger: new FlowLog(),
      gateEvaluator: cliGateEvaluator,
      bindingService: cliService,
    });
    const cliResult = await cliRunner.execute(flow, { userPrompt: "grade this", traceId: crypto.randomUUID() });
    assertEquals(cliResult.success, true);
    // The claude-cli generate-backed provider ran the grade.
    assertEquals(factory.calls.length, 1);
    assertEquals(factory.calls[0]?.model, "claude");
  } finally {
    await cleanup();
  }
});

Deno.test("gate and judge providers receive the snapshot's effective effort/thinking in generate options", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const factory = new MockProviderFactory((_model) => JUDGE_OK);
  registerFactory("mock", factory);
  try {
    const canonicalMock = `mock/${getDefaultModels().mock}`;
    const config: Config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: {
        services: {
          alpha: { adapter: "mock", transport: "local", interface: "api", serves: { [canonicalMock]: "alpha" } },
        },
      },
      bindings: {
        "flow:research/step:gate1": { service: "alpha", model: canonicalMock, effort: "high", thinking: true },
      },
    });
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const nullRunner = { run: () => Promise.resolve({ content: JUDGE_OK }) } as never;
    const judge = new JudgeEvaluator(new JudgeAgentRunner(nullRunner, service));
    const gateEvaluator = new GateEvaluator(judge);
    const gateFlow = FlowSchema.parse({
      id: "research",
      name: "Research",
      description: "gate",
      version: "1.0.0",
      steps: [{
        id: "gate1",
        name: "Gate 1",
        type: FlowStepType.GATE,
        agent_role: "reviewer",
        evaluate: {
          agent_role: "reviewer",
          criteria: ["CODE_CORRECTNESS"],
          threshold: 0.8,
          onFail: "halt",
          maxRetries: 3,
          includeRequestCriteria: false,
        },
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST },
      }],
      output: { from: "gate1", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
    });
    const runner = new FlowRunner({
      agentExecutor: { run: () => Promise.resolve({ content: "", raw: "", thought: "" }) } as never,
      eventLogger: new FlowLog(),
      gateEvaluator,
      bindingService: service,
    });
    const result = await runner.execute(gateFlow, { userPrompt: "grade", traceId: crypto.randomUUID() });
    assertEquals(result.success, true);
    assertEquals(factory.calls.length, 1);
    assertEquals(factory.calls[0]?.options?.effort, "high");
    assertEquals(factory.calls[0]?.options?.thinking, true);
  } finally {
    await cleanup();
  }
});

Deno.test("two DYNAMIC steps with different bindings use two LlmClients over two providers; an unbound DYNAMIC step keeps the shared executor", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const alpha = new MockProviderFactory(() =>
    JSON.stringify({ reasoning: "done", action: { type: "complete", output: "alpha-out" } })
  );
  registerFactory("mock", alpha);
  try {
    const canonicalMock = `mock/${getDefaultModels().mock}`;
    const config: Config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      execution: { native_tools_enabled: false, milestone_streaming_enabled: true },
      catalog: {
        models: { "mock/beta": { model_provider: "mock" } },
        services: {
          alpha: { adapter: "mock", transport: "local", interface: "api", serves: { [canonicalMock]: "alpha" } },
          beta: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/beta": "beta" } },
        },
      },
      bindings: {
        "flow:research/step:a": { service: "alpha", model: canonicalMock, effort: "high", thinking: true },
        "flow:research/step:b": { service: "beta", model: "mock/beta" },
      },
    });
    await writeBlueprints(tempDir, ["builder"]);
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger: createMockEventLogger(),
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const dynFlow = FlowSchema.parse({
      id: "research",
      name: "Research",
      description: "dyn",
      version: "1.0.0",
      steps: [
        {
          id: "a",
          name: "A",
          agent_role: "builder",
          execution_mode: FlowStepExecutionMode.DYNAMIC,
          dependsOn: [],
          input: { source: FlowInputSource.REQUEST },
        },
        {
          id: "b",
          name: "B",
          agent_role: "builder",
          execution_mode: FlowStepExecutionMode.DYNAMIC,
          dependsOn: ["a"],
          input: { source: FlowInputSource.REQUEST },
        },
      ],
      output: { from: "b", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
    });
    const events: string[] = [];
    const capturingLogger: IFlowEventLogger = {
      log: (event: string) => {
        events.push(event);
      },
    };
    const runner = new FlowRunner({
      agentExecutor: { run: () => Promise.resolve({ content: "", raw: "", thought: "" }) } as never,
      eventLogger: capturingLogger,
      config,
      db,
      mcpClient: new RecordingMcpClient(),
      bindingService: service,
    });
    const result = await runner.execute(dynFlow, { userPrompt: "run", traceId: crypto.randomUUID() });
    assertEquals(result.success, true);
    // Step a's LlmClient ran the alpha-bound provider and step b's the beta-bound one.
    assertEquals(alpha.calls.map((c) => c.model), ["alpha", "beta"]);
    // The alpha binding's effective effort/thinking reached the DYNAMIC LlmClient's generate.
    const alphaCall = alpha.calls.find((c) => c.model === "alpha");
    assertEquals(alphaCall?.options?.effort, "high");
    assertEquals(alphaCall?.options?.thinking, true);
    // Two distinct executors were created (one per binding fingerprint).
    assertEquals(events.filter((e) => e === "dynamic_step_completed").length, 2);
    assertEquals(alpha.creates.length, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("an unbound DYNAMIC step keeps the shared executor while bound steps get per-fingerprint executors", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const alpha = new MockProviderFactory(() =>
    JSON.stringify({ reasoning: "done", action: { type: "complete", output: "alpha-out" } })
  );
  registerFactory("mock", alpha);
  try {
    const config: Config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      execution: { native_tools_enabled: false, milestone_streaming_enabled: true },
      catalog: {
        models: { "mock/alpha": { model_provider: "mock" } },
        services: {
          alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
        },
      },
      bindings: {
        "flow:research/step:a": { service: "alpha", model: "mock/alpha" },
      },
    });
    await writeBlueprints(tempDir, ["builder"]);
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger: createMockEventLogger(),
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const dynFlow = FlowSchema.parse({
      id: "research",
      name: "Research",
      description: "dyn-unbound",
      version: "1.0.0",
      steps: [
        {
          id: "a",
          name: "A",
          agent_role: "builder",
          execution_mode: FlowStepExecutionMode.DYNAMIC,
          dependsOn: [],
          input: { source: FlowInputSource.REQUEST },
        },
        {
          id: "c",
          name: "C",
          agent_role: "builder",
          execution_mode: FlowStepExecutionMode.DYNAMIC,
          dependsOn: ["a"],
          input: { source: FlowInputSource.REQUEST },
        },
      ],
      output: { from: "c", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
    });
    const events: string[] = [];
    const capturingLogger: IFlowEventLogger = {
      log: (event: string) => {
        events.push(event);
      },
    };
    const resolver = {
      resolve: () => Promise.resolve({ provider: "mock", model: "boot", attempt: 1 }),
    } as never;
    const runner = new FlowRunner({
      agentExecutor: { run: () => Promise.resolve({ content: "", raw: "", thought: "" }) } as never,
      eventLogger: capturingLogger,
      config,
      db,
      mcpClient: new RecordingMcpClient(),
      bindingService: service,
      modelResolver: resolver,
      dynamicModel: "medium",
    });
    const result = await runner.execute(dynFlow, { userPrompt: "run", traceId: crypto.randomUUID() });
    assertEquals(result.success, true);
    // Step a ran on the alpha-bound provider.
    // The unbound step c ran on the shared executor with the resolver default model.
    const stepA = alpha.calls.find((c) => c.model === "alpha");
    const unbound = alpha.calls.find((c) => c.model !== "alpha");
    assertEquals(stepA !== undefined, true);
    assertEquals(unbound !== undefined, true);
    assertEquals(alpha.creates.length, 2); // alpha (bound) + shared resolver model
  } finally {
    await cleanup();
  }
});

Deno.test("a session_delegate_cycle step's review gate grades on the cycle step's bound provider", async () => {
  const { db, cleanup } = await initTestDbService();
  const factory = new MockProviderFactory((_model) => JUDGE_OK);
  registerFactory("mock", factory);
  const root = await Deno.makeTempDir({ prefix: "cycle-bindings-" });
  try {
    const config: Config = ConfigSchema.parse({
      system: { root },
      paths: {},
      ai: { provider: "mock", model: "boot" },
      catalog: {
        models: { "mock/alpha": { model_provider: "mock" } },
        services: {
          alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
        },
      },
      bindings: {
        "flow:cycle-flow/step:next-steps": { service: "alpha", model: "mock/alpha" },
      },
    });
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    // PlanContext fixture plus a recording delegation coordinator, so the cycle step's
    // review gate runs against a real delegated outcome.
    const planDir = join(root, ".exa", "PlanContext");
    await Deno.mkdir(planDir, { recursive: true });
    await Deno.writeTextFile(
      join(planDir, "phase-204.md"),
      "## Step 1\n\n**Actions:**\n- Do it\n\n```yaml\n# step-manifest\nstep: 1\ntitle: Do it\n```\n",
    );
    const commissioning: IFlowStepRequest[] = [];
    const coordinator = {
      delegate: (input: { parentTraceId: string; parentStepId: string; sequence: number }) => {
        commissioning.push(input as never);
        return Promise.resolve({
          delegationTraceId: crypto.randomUUID(),
          parentTraceId: input.parentTraceId,
          parentStepId: input.parentStepId,
          sequence: input.sequence,
          status: "completed",
          decision: "changes_made",
          summary: "implemented step 1",
          pathsTouched: ["src/a.ts"],
        });
      },
    };
    const judge = new JudgeEvaluator(
      new JudgeAgentRunner(
        { run: () => Promise.resolve({ content: JUDGE_OK }) } as never,
        service,
      ),
    );
    const gateEvaluator = new GateEvaluator(judge);
    const runner = new FlowRunner({
      agentExecutor: { run: () => Promise.resolve({ content: "", raw: "", thought: "" }) } as never,
      eventLogger: new FlowLog(),
      gateEvaluator,
      bindingService: service,
      sessionDelegationCoordinator: coordinator as never,
      planContextResolver: new PlanContextResolver(),
    });
    const flow = FlowSchema.parse({
      id: "cycle-flow",
      name: "Cycle",
      description: "cycle",
      version: "1.0.0",
      steps: [{
        id: "next-steps",
        name: "Next Steps",
        type: FlowStepType.SESSION_DELEGATE_CYCLE,
        agent_role: "senior-coder",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST },
        delegateCycle: {
          requireChangedPaths: true,
          review: {
            agent_role: "reviewer",
            criteria: ["CODE_CORRECTNESS"],
            threshold: 0.8,
            onFail: "halt",
            maxRetries: 3,
            includeRequestCriteria: false,
          },
        },
      }],
      output: { from: "next-steps", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
    });
    const result = await runner.execute(flow, {
      userPrompt: "run",
      traceId: crypto.randomUUID(),
      requestId: "req-cycle",
      portal: "workspace",
      executionRoot: root,
      planContextRef: ".exa/PlanContext/phase-204.md",
    });
    assertEquals(result.success, true);
    // The review gate ran the bound provider (alpha model) — not the boot judge.
    assertEquals(factory.calls.length, 1);
    assertEquals(factory.calls[0]?.model, "alpha");
  } finally {
    await cleanup();
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
