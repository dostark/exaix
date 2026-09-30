/**
 * @module FlowStepBindingsDeclaredTest
 * @path tests/integration/flow_step_bindings_declared_test.ts
 * @description Verifies per-step model binding through the production flow adapter.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  type IModelOptions,
  type IModelProvider,
  type IResolvedProviderOptions,
  ModelBindingService,
  ProviderRegistry,
} from "@exaix/ai";
import type { IProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { MockProvider } from "@exaix/ai/providers.ts";
import { FlowOutputFormat, PricingTier, ProviderCostTier } from "@exaix/core";
import { AgentRunner } from "@exaix/execution";
import { AgentComposerAdapter, FlowRunner, type IFlowEventLogger } from "@exaix/flow";
import { type Config, ConfigSchema, EffortTierSchema, FlowSchema, getDefaultModels } from "@exaix/schemas";
import { ConfigService, createConfigReloadHandler } from "@exaix/core/config";
import { createMockEventLogger, initTestDbService } from "@exaix/testing";
import type { JSONValue } from "@exaix/core";

const flow = FlowSchema.parse({
  id: "research",
  name: "Research",
  description: "Two service flow",
  steps: [
    { id: "compose", name: "Compose", agent_role: "composer" },
    { id: "explore", name: "Explore", agent_role: "explorer", dependsOn: ["compose"] },
  ],
  output: { from: "explore", format: FlowOutputFormat.MARKDOWN },
});

class CapturingFactory implements IProviderFactory {
  readonly calls: string[] = [];
  readonly options: Array<IModelOptions | undefined> = [];
  onGenerate?: (model: string) => Promise<void>;
  failCreate = false;
  create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    if (this.failCreate) return Promise.reject(new Error("factory unavailable"));
    const model = options.model;
    return Promise.resolve({
      id: `bound-${model}`,
      callCapabilities: {
        profile: "mock",
        supportedEffortTiers: [EffortTierSchema.enum.low, EffortTierSchema.enum.medium, EffortTierSchema.enum.high],
        supportsThinking: true,
      },
      generate: async (_prompt: string, options?: IModelOptions): Promise<IGenerateResult> => {
        this.calls.push(model);
        this.options.push(options);
        await this.onGenerate?.(model);
        return {
          content: `<thought>ok</thought><content>${model}</content>`,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model,
          provider: "mock",
          cost_usd: 0,
        };
      },
    });
  }
}

class FlowLog implements IFlowEventLogger {
  readonly actions: string[] = [];
  log(action: string, _payload: Record<string, JSONValue | undefined>): void {
    this.actions.push(action);
  }
}

function configFor(root: string, bindings?: Config["bindings"]): Config {
  return ConfigSchema.parse({
    system: { root },
    paths: {},
    ai: { provider: "mock", model: "boot" },
    bindings,
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

Deno.test("declared flow steps call their bound mock service and emit traced resolutions", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const factory = new CapturingFactory();
  ProviderRegistry.registerWithMetadata("mock", factory, {
    name: "mock",
    description: "captured mock",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
  try {
    const blueprints = join(tempDir, "Blueprints", "Agents");
    await Deno.mkdir(blueprints, { recursive: true });
    for (const role of ["composer", "explorer"]) {
      await Deno.writeTextFile(
        join(blueprints, `${role}.md`),
        `---\nagent_role: ${role}\nmodel: mock:boot\n---\nYou are ${role}.`,
      );
    }
    let config = configFor(tempDir, {
      "flow:research/step:compose": { service: "alpha", model: "mock/alpha" },
      "flow:research/step:explore": { service: "beta", model: "mock/beta" },
    });
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const boot = new MockProvider("<thought>ok</thought><content>boot</content>");
    const adapter = new AgentComposerAdapter(new AgentRunner(boot), blueprints, undefined, service);
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
    const traceId = crypto.randomUUID();
    const result = await runner.execute(flow, { userPrompt: "Research", traceId });
    assertEquals(result.success, true);
    assertEquals(factory.calls, ["alpha", "beta"]);
    const resolved = logger.events.filter((event) => event.action === "binding.resolved");
    assertEquals(resolved.map((event) => event.traceId), [traceId, traceId]);

    config = configFor(tempDir, { default: { service: "beta", model: "mock/beta" } });
    factory.calls.length = 0;
    await runner.execute(flow, { userPrompt: "Research again", traceId: crypto.randomUUID() });
    assertEquals(factory.calls, ["beta", "beta"]);
  } finally {
    await cleanup();
  }
});

Deno.test("invalid Step 1 binding fails preflight with zero flow provider calls", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const factory = new CapturingFactory();
  ProviderRegistry.registerWithMetadata("mock", factory, {
    name: "mock",
    description: "captured mock",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
  try {
    const logger = createMockEventLogger();
    const blueprints = join(tempDir, "Blueprints", "Agents");
    await Deno.mkdir(blueprints, { recursive: true });
    for (const role of ["composer", "explorer"]) {
      await Deno.writeTextFile(
        join(blueprints, `${role}.md`),
        `---\nagent_role: ${role}\nmodel: mock:boot\n---\nYou are ${role}.`,
      );
    }
    const service = new ModelBindingService({
      configSource: { get: () => configFor(tempDir, { default: { service: "missing", model: "mock/alpha" } }) },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const adapter = new AgentComposerAdapter(
      new AgentRunner(new MockProvider("<thought>ok</thought><content>boot</content>")),
      blueprints,
      undefined,
      service,
    );
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
    const result = await runner.execute(flow, { userPrompt: "Research", traceId: crypto.randomUUID() });
    assertEquals(result.success, false);
    assertEquals(factory.calls, []);
    assertEquals(logger.events.filter((event) => event.action === "binding.rejected").length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("a flow without bindings uses the boot provider and emits no binding events", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const blueprints = join(tempDir, "Blueprints", "Agents");
    await Deno.mkdir(blueprints, { recursive: true });
    for (const role of ["composer", "explorer"]) {
      await Deno.writeTextFile(
        join(blueprints, `${role}.md`),
        `---\nagent_role: ${role}\nmodel: mock:boot\n---\nYou are ${role}.`,
      );
    }
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => configFor(tempDir) },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const boot = new MockProvider("<thought>ok</thought><content>boot</content>");
    const adapter = new AgentComposerAdapter(new AgentRunner(boot), blueprints, undefined, service);
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
    const result = await runner.execute(flow, { userPrompt: "Research" });
    assertEquals(result.success, true);
    assertEquals([...result.stepResults.values()].map((step) => step.result?.content), ["boot", "boot"]);
    assertEquals(logger.events.filter((event) => event.action.startsWith("binding.")), []);
  } finally {
    await cleanup();
  }
});

Deno.test("a config reload changes the next run's bound service", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const factory = new CapturingFactory();
  ProviderRegistry.registerWithMetadata("mock", factory, {
    name: "mock",
    description: "captured mock",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
  try {
    const blueprints = join(tempDir, "Blueprints", "Agents");
    await Deno.mkdir(blueprints, { recursive: true });
    for (const role of ["composer", "explorer"]) {
      await Deno.writeTextFile(
        join(blueprints, `${role}.md`),
        `---\nagent_role: ${role}\nmodel: mock:boot\n---\nYou are ${role}.`,
      );
    }
    const configPath = join(tempDir, "exa.config.toml");
    const writeConfig = (service: string, model: string): Promise<void> =>
      Deno.writeTextFile(
        configPath,
        `
[system]
root = "${tempDir}"
[ai]
provider = "mock"
model = "boot"
[catalog.models."mock/alpha"]
model_provider = "mock"
[catalog.models."mock/beta"]
model_provider = "mock"
[catalog.services.alpha]
adapter = "mock"
transport = "local"
interface = "api"
[catalog.services.alpha.serves]
"mock/alpha" = "alpha"
[catalog.services.beta]
adapter = "mock"
transport = "local"
interface = "api"
[catalog.services.beta.serves]
"mock/beta" = "beta"
[bindings.default]
service = "${service}"
model = "${model}"
`,
      );
    await writeConfig("alpha", "mock/alpha");
    const configService = new ConfigService(configPath);
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: configService,
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const adapter = new AgentComposerAdapter(
      new AgentRunner(new MockProvider("<thought>ok</thought><content>boot</content>")),
      blueprints,
      undefined,
      service,
    );
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
    await runner.execute(flow, { userPrompt: "First" });
    assertEquals(factory.calls, ["alpha", "alpha"]);
    factory.calls.length = 0;
    await writeConfig("beta", "mock/beta");
    await createConfigReloadHandler(configService, logger)({ path: configPath });
    await runner.execute(flow, { userPrompt: "Second" });
    assertEquals(factory.calls, ["beta", "beta"]);
  } finally {
    await cleanup();
  }
});

Deno.test("an active run keeps its snapshot while a concurrent run reads new bindings", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const factory = new CapturingFactory();
  ProviderRegistry.registerWithMetadata("mock", factory, {
    name: "mock",
    description: "captured mock",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
  try {
    const blueprints = join(tempDir, "Blueprints", "Agents");
    await Deno.mkdir(blueprints, { recursive: true });
    for (const role of ["composer", "explorer"]) {
      await Deno.writeTextFile(
        join(blueprints, `${role}.md`),
        `---\nagent_role: ${role}\nmodel: mock:boot\n---\nYou are ${role}.`,
      );
    }
    let config = configFor(tempDir, { default: { service: "alpha", model: "mock/alpha" } });
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const adapter = new AgentComposerAdapter(
      new AgentRunner(new MockProvider("<thought>ok</thought><content>boot</content>")),
      blueprints,
      undefined,
      service,
    );
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
    let enteredFirst!: () => void;
    let releaseFirst!: () => void;
    const entered = new Promise<void>((resolve) => enteredFirst = resolve);
    const held = new Promise<void>((resolve) => releaseFirst = resolve);
    let blocked = false;
    factory.onGenerate = async (model) => {
      if (model === "alpha" && !blocked) {
        blocked = true;
        enteredFirst();
        await held;
      }
    };
    const first = runner.execute(flow, { userPrompt: "First" });
    await entered;
    config = configFor(tempDir, { default: { service: "beta", model: "mock/beta" } });
    const second = await runner.execute(flow, { userPrompt: "Second" });
    releaseFirst();
    const firstResult = await first;
    assertEquals(firstResult.success, true);
    assertEquals(second.success, true);
    assertEquals(factory.calls.filter((model) => model === "alpha").length, 2);
    assertEquals(factory.calls.filter((model) => model === "beta").length, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("binding effort and thinking override flow step declarations in generate options", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const factory = new CapturingFactory();
  ProviderRegistry.registerWithMetadata("mock", factory, {
    name: "mock",
    description: "captured mock",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
  try {
    const blueprints = join(tempDir, "Blueprints", "Agents");
    await Deno.mkdir(blueprints, { recursive: true });
    for (const role of ["composer", "explorer"]) {
      await Deno.writeTextFile(
        join(blueprints, `${role}.md`),
        `---\nagent_role: ${role}\nmodel: mock:boot\n---\nYou are ${role}.`,
      );
    }
    const canonicalMock = `mock/${getDefaultModels().mock}`;
    const config = ConfigSchema.parse({
      ...configFor(tempDir, { default: { service: "alpha", model: canonicalMock, effort: "low", thinking: true } }),
      catalog: {
        services: {
          alpha: { adapter: "mock", transport: "local", interface: "api", serves: { [canonicalMock]: "alpha" } },
        },
      },
    });
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger: createMockEventLogger(),
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const adapter = new AgentComposerAdapter(
      new AgentRunner(new MockProvider("<thought>ok</thought><content>boot</content>")),
      blueprints,
      undefined,
      service,
    );
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
    const declared = FlowSchema.parse({
      ...flow,
      steps: flow.steps.map((step) => ({ ...step, effort: "high", thinking: false })),
    });
    const result = await runner.execute(declared, { userPrompt: "Research" });
    assertEquals(result.success, true);
    assertEquals(factory.options.map((options) => options?.effort), ["low", "low"]);
    assertEquals(factory.options.map((options) => options?.thinking), [true, true]);
  } finally {
    await cleanup();
  }
});

Deno.test("factory construction failure rejects once before the first flow generate call", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const factory = new CapturingFactory();
  factory.failCreate = true;
  ProviderRegistry.registerWithMetadata("mock", factory, {
    name: "mock",
    description: "captured mock",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
  try {
    const blueprints = join(tempDir, "Blueprints", "Agents");
    await Deno.mkdir(blueprints, { recursive: true });
    for (const role of ["composer", "explorer"]) {
      await Deno.writeTextFile(
        join(blueprints, `${role}.md`),
        `---\nagent_role: ${role}\nmodel: mock:boot\n---\nYou are ${role}.`,
      );
    }
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => configFor(tempDir, { default: { service: "alpha", model: "mock/alpha" } }) },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const adapter = new AgentComposerAdapter(
      new AgentRunner(new MockProvider("<thought>ok</thought><content>boot</content>")),
      blueprints,
      undefined,
      service,
    );
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
    const result = await runner.execute(flow, { userPrompt: "Research", traceId: crypto.randomUUID() });
    assertEquals(result.success, false);
    assertEquals(factory.calls, []);
    assertEquals(logger.events.filter((event) => event.action === "binding.rejected").length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("a role binding in config moves every step of that role to the bound service", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const factory = new CapturingFactory();
  ProviderRegistry.registerWithMetadata("mock", factory, {
    name: "mock",
    description: "captured mock",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
  try {
    const blueprints = join(tempDir, "Blueprints", "Agents");
    await Deno.mkdir(blueprints, { recursive: true });
    for (const role of ["composer", "explorer"]) {
      await Deno.writeTextFile(
        join(blueprints, `${role}.md`),
        `---\nagent_role: ${role}\nmodel: mock:boot\n---\nYou are ${role}.`,
      );
    }
    const config = ConfigSchema.parse({
      ...configFor(tempDir, {
        "role:composer": { model: "mock/alpha" },
        "role:explorer": { model: "mock/beta" },
      }),
      catalog: {
        models: { "mock/alpha": { model_provider: "mock" }, "mock/beta": { model_provider: "mock" } },
        services: {
          alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
          beta: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/beta": "beta" } },
        },
        preferences: { mock: ["alpha", "beta"] },
      },
    });
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const adapter = new AgentComposerAdapter(
      new AgentRunner(new MockProvider("<thought>ok</thought><content>boot</content>")),
      blueprints,
      undefined,
      service,
    );
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
    const traceId = crypto.randomUUID();
    const result = await runner.execute(flow, { userPrompt: "Research", traceId });
    assertEquals(result.success, true);
    assertEquals(factory.calls, ["alpha", "beta"]);
    const resolved = logger.events.filter((event) => event.action === "binding.resolved");
    assertEquals(resolved.length, 2);
    assertEquals(resolved.every((event) => event.traceId === traceId), true);
    const sources = resolved.map((event) =>
      (event.payload as { sources?: { service?: { selector?: string } } }).sources
    );
    assertEquals(sources[0]?.service?.selector, "role:composer");
    assertEquals(sources[1]?.service?.selector, "role:explorer");
  } finally {
    await cleanup();
  }
});

Deno.test("resolved and rejected events carry the same run trace as the request; a retried bound step emits one resolved event per acquisition attempt", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const factory = new CapturingFactory();
  let attempt = 0;
  factory.onGenerate = () => {
    attempt++;
    if (attempt === 1) {
      return Promise.reject(new Error("transient failure"));
    }
    return Promise.resolve();
  };
  ProviderRegistry.registerWithMetadata("mock", factory, {
    name: "mock",
    description: "captured mock",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
  try {
    const blueprints = join(tempDir, "Blueprints", "Agents");
    await Deno.mkdir(blueprints, { recursive: true });
    await Deno.writeTextFile(
      join(blueprints, "composer.md"),
      `---\nagent_role: composer\nmodel: mock:boot\n---\nYou are composer.`,
    );
    const retryFlow = FlowSchema.parse({
      id: "retry-flow",
      name: "Retry Flow",
      description: "Retry flow test",
      steps: [
        {
          id: "compose",
          name: "Compose",
          agent_role: "composer",
          onError: { action: "retry", maxRetries: 2, backoffMs: 1 },
        },
      ],
      output: { from: "compose", format: FlowOutputFormat.MARKDOWN },
    });
    const config = configFor(tempDir, {
      "flow:retry-flow/step:compose": { service: "alpha", model: "mock/alpha" },
    });
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const boot = new MockProvider("<thought>ok</thought><content>boot</content>");
    const adapter = new AgentComposerAdapter(new AgentRunner(boot), blueprints, undefined, service);
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
    const traceId = crypto.randomUUID();
    const result = await runner.execute(retryFlow, { userPrompt: "Run retry", traceId });
    assertEquals(result.success, true);
    assertEquals(factory.calls, ["alpha", "alpha"]);

    const resolved = logger.events.filter((event) => event.action === "binding.resolved");
    assertEquals(resolved.length, 2);
    for (const event of resolved) {
      assertEquals(event.traceId, traceId);
      assertEquals((event.payload as { trace_id?: string }).trace_id, traceId);
    }

    const rejectConfig = configFor(tempDir, {
      default: { service: "non-existent-service", model: "mock/alpha" },
    });
    const rejectLogger = createMockEventLogger();
    const rejectService = new ModelBindingService({
      configSource: { get: () => rejectConfig },
      logger: rejectLogger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const rejectAdapter = new AgentComposerAdapter(new AgentRunner(boot), blueprints, undefined, rejectService);
    const rejectRunner = new FlowRunner({
      agentExecutor: rejectAdapter,
      eventLogger: new FlowLog(),
      bindingService: rejectService,
    });
    const rejectTraceId = crypto.randomUUID();
    const rejectResult = await rejectRunner.execute(retryFlow, { userPrompt: "Run reject", traceId: rejectTraceId });
    assertEquals(rejectResult.success, false);
    const rejected = rejectLogger.events.filter((event) => event.action === "binding.rejected");
    assertEquals(rejected.length, 1);
    assertEquals(rejected[0].traceId, rejectTraceId);
    assertEquals((rejected[0].payload as { trace_id?: string }).trace_id, rejectTraceId);
  } finally {
    await cleanup();
  }
});
