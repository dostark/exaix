/**
 * @module FlowStepBindingsDeclaredTest
 * @path tests/integration/flow_step_bindings_declared_test.ts
 * @description Verifies per-step model binding through the production flow adapter.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FlowOutputFormat } from "@exaix/core";
import { type Config, ConfigSchema, FlowSchema, getDefaultModels } from "@exaix/schemas";
import { ConfigService, createConfigReloadHandler } from "@exaix/core/config";
import { initTestDbService } from "@exaix/testing";
import { alphaBetaConfig, CapturingFactory, createBindingHarness } from "./helpers/flow_binding_harness.ts";

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

const alphaOnly = (): Config["bindings"] => ({ default: { service: "alpha", model: "mock/alpha" } });

Deno.test("declared flow steps call their bound mock service and emit traced resolutions", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    let config = alphaBetaConfig(tempDir, {
      "flow:research/step:compose": { service: "alpha", model: "mock/alpha" },
      "flow:research/step:explore": { service: "beta", model: "mock/beta" },
    });
    const { factory, logger, runner } = await createBindingHarness({
      tempDir,
      db,
      configSource: { get: () => config },
    });
    const traceId = crypto.randomUUID();
    const result = await runner.execute(flow, { userPrompt: "Research", traceId });
    assertEquals(result.success, true);
    assertEquals(factory.calls, ["alpha", "beta"]);
    const resolved = logger.events.filter((event) => event.action === "binding.resolved");
    assertEquals(resolved.map((event) => event.traceId), [traceId, traceId]);

    config = alphaBetaConfig(tempDir, { default: { service: "beta", model: "mock/beta" } });
    factory.calls.length = 0;
    await runner.execute(flow, { userPrompt: "Research again", traceId: crypto.randomUUID() });
    assertEquals(factory.calls, ["beta", "beta"]);
  } finally {
    await cleanup();
  }
});

Deno.test("invalid Step 1 binding fails preflight with zero flow provider calls", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const config = alphaBetaConfig(tempDir, { default: { service: "missing", model: "mock/alpha" } });
    const { factory, logger, runner } = await createBindingHarness({
      tempDir,
      db,
      configSource: { get: () => config },
    });
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
    const config = alphaBetaConfig(tempDir);
    const { logger, runner } = await createBindingHarness({ tempDir, db, configSource: { get: () => config } });
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
  try {
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
    const { factory, logger, runner } = await createBindingHarness({ tempDir, db, configSource: configService });
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
  try {
    let config = alphaBetaConfig(tempDir, alphaOnly());
    const { factory, runner } = await createBindingHarness({ tempDir, db, configSource: { get: () => config } });
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
    config = alphaBetaConfig(tempDir, { default: { service: "beta", model: "mock/beta" } });
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
  try {
    const canonicalMock = `mock/${getDefaultModels().mock}`;
    const config = ConfigSchema.parse({
      ...alphaBetaConfig(tempDir, {
        default: { service: "alpha", model: canonicalMock, effort: "low", thinking: true },
      }),
      catalog: {
        services: {
          alpha: { adapter: "mock", transport: "local", interface: "api", serves: { [canonicalMock]: "alpha" } },
        },
      },
    });
    const { factory, runner } = await createBindingHarness({ tempDir, db, configSource: { get: () => config } });
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
  try {
    const factory = new CapturingFactory();
    factory.failCreate = true;
    const config = alphaBetaConfig(tempDir, alphaOnly());
    const { logger, runner } = await createBindingHarness({
      tempDir,
      db,
      factory,
      configSource: { get: () => config },
    });
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
  try {
    const config = ConfigSchema.parse({
      ...alphaBetaConfig(tempDir, {
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
    const { factory, logger, runner } = await createBindingHarness({
      tempDir,
      db,
      configSource: { get: () => config },
    });
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
  try {
    const factory = new CapturingFactory();
    let attempt = 0;
    factory.onGenerate = () => {
      attempt++;
      return attempt === 1 ? Promise.reject(new Error("transient failure")) : Promise.resolve();
    };
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
    const config = alphaBetaConfig(tempDir, {
      "flow:retry-flow/step:compose": { service: "alpha", model: "mock/alpha" },
    });
    const { logger, runner } = await createBindingHarness({
      tempDir,
      db,
      factory,
      roles: ["composer"],
      configSource: { get: () => config },
    });
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

    const rejectConfig = alphaBetaConfig(tempDir, {
      default: { service: "non-existent-service", model: "mock/alpha" },
    });
    const reject = await createBindingHarness({
      tempDir,
      db,
      roles: ["composer"],
      configSource: { get: () => rejectConfig },
    });
    const rejectTraceId = crypto.randomUUID();
    const rejectResult = await reject.runner.execute(retryFlow, { userPrompt: "Run reject", traceId: rejectTraceId });
    assertEquals(rejectResult.success, false);
    const rejected = reject.logger.events.filter((event) => event.action === "binding.rejected");
    assertEquals(rejected.length, 1);
    assertEquals(rejected[0].traceId, rejectTraceId);
    assertEquals((rejected[0].payload as { trace_id?: string }).trace_id, rejectTraceId);
  } finally {
    await cleanup();
  }
});

Deno.test("a flow-file binding runs the step on its declared service with no config layer", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const config = alphaBetaConfig(tempDir);
    const { factory, logger, runner } = await createBindingHarness({
      tempDir,
      db,
      configSource: { get: () => config },
    });
    const boundFlow = FlowSchema.parse({
      id: "research",
      name: "Research",
      description: "Flow-file binding",
      version: "1.0.0",
      steps: [
        {
          id: "compose",
          name: "Compose",
          agent_role: "composer",
          dependsOn: [],
          input: { source: "request" },
          binding: { service: "alpha", model: "mock/alpha" },
        },
        {
          id: "explore",
          name: "Explore",
          agent_role: "explorer",
          dependsOn: ["compose"],
          input: { source: "request" },
        },
      ],
      output: { from: "explore", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
    });

    const result = await runner.execute(boundFlow, { userPrompt: "Research", traceId: crypto.randomUUID() });
    assertEquals(result.success, true);
    // Compose ran on the bound alpha service.
    // Explore had no binding and used the boot provider.
    assertEquals(factory.calls, ["alpha"]);
    const resolved = logger.events.filter((event) => event.action === "binding.resolved");
    assertEquals(resolved.length, 1);
    assertEquals((resolved[0].payload as { service?: string }).service, "alpha");
  } finally {
    await cleanup();
  }
});
