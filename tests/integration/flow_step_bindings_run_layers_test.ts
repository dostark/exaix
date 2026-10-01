/**
 * @module FlowStepBindingsRunLayersTest
 * @path tests/integration/flow_step_bindings_run_layers_test.ts
 * @description Step 11: a run whose only binding source is its operator run file still
 *   binds, and a drifted `--locked` lock fails the run before any provider call.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  type IModelProvider,
  type IResolvedProviderOptions,
  ModelBindingService,
  ProviderRegistry,
  RunBindingsStore,
} from "@exaix/ai";
import type { IProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { MockProvider } from "@exaix/ai/providers.ts";
import { FlowOutputFormat, PricingTier, ProviderCostTier } from "@exaix/core";
import { AgentRunner } from "@exaix/execution";
import { AgentComposerAdapter, FlowRunner, type IFlowEventLogger } from "@exaix/flow";
import { type Config, ConfigSchema, FlowSchema, type IRunBindingsFile } from "@exaix/schemas";
import { createMockEventLogger, initTestDbService } from "@exaix/testing";
import type { IDatabaseService, JSONValue } from "@exaix/core";

const flow = FlowSchema.parse({
  id: "research",
  name: "Research",
  description: "Run layer flow",
  steps: [
    { id: "compose", name: "Compose", agent_role: "composer" },
    { id: "explore", name: "Explore", agent_role: "explorer", dependsOn: ["compose"] },
  ],
  output: { from: "explore", format: FlowOutputFormat.MARKDOWN },
});

const REQUEST_PATH = "Workspace/Requests/request-run-layer.md";
const REQUEST_SHA = "a".repeat(64);

class CapturingFactory implements IProviderFactory {
  readonly calls: string[] = [];
  create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const model = options.model;
    return Promise.resolve({
      id: `bound-${model}`,
      callCapabilities: { profile: "mock", supportedEffortTiers: [], supportsThinking: true },
      generate: (): Promise<IGenerateResult> => {
        this.calls.push(model);
        return Promise.resolve({
          content: `<thought>ok</thought><content>${model}</content>`,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model,
          provider: "mock",
          cost_usd: 0,
        });
      },
    });
  }
}

class FlowLog implements IFlowEventLogger {
  log(_action: string, _payload: Record<string, JSONValue | undefined>): void {}
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

async function harness(tempDir: string, db: IDatabaseService) {
  const factory = new CapturingFactory();
  ProviderRegistry.registerWithMetadata("mock", factory, {
    name: "mock",
    description: "captured mock",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
  const blueprints = join(tempDir, "Blueprints", "Agents");
  await Deno.mkdir(blueprints, { recursive: true });
  for (const role of ["composer", "explorer"]) {
    await Deno.writeTextFile(
      join(blueprints, `${role}.md`),
      `---\nagent_role: ${role}\nmodel: mock:boot\n---\nYou are ${role}.`,
    );
  }
  const config = configFor(tempDir);
  const logger = createMockEventLogger();
  const service = new ModelBindingService({
    configSource: { get: () => config },
    logger,
    db,
    runStore: new RunBindingsStore(config),
    probe: { hasKey: () => true, hasOptIn: () => true },
  });
  const boot = new MockProvider("<thought>ok</thought><content>boot</content>");
  const adapter = new AgentComposerAdapter(new AgentRunner(boot), blueprints, undefined, service);
  const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });
  return { factory, logger, config, runner };
}

function runFile(traceId: string, extra: Partial<IRunBindingsFile>): IRunBindingsFile {
  return {
    schema: 1,
    trace_id: traceId,
    request_path: REQUEST_PATH,
    request_sha256: REQUEST_SHA,
    created_at: new Date().toISOString(),
    overlays: [],
    binds: [],
    ...extra,
  };
}

Deno.test("[runtime] --bind alone on a daemon with no config bindings and no overlay directory moves the step and writes a lock", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const { factory, logger, config, runner } = await harness(tempDir, db);
    const traceId = crypto.randomUUID();
    await new RunBindingsStore(config).write(runFile(traceId, {
      binds: [{ selector: "default", spec: { service: "beta", model: "mock/beta" } }],
    }));
    const result = await runner.execute(flow, {
      userPrompt: "Research",
      traceId,
      requestPath: REQUEST_PATH,
      requestSha256: REQUEST_SHA,
    });
    assertEquals(result.success, true);
    assertEquals(factory.calls, ["beta", "beta"]);
    const resolved = logger.events.filter((event) => event.action === "binding.resolved");
    assertEquals(resolved.length, 2);
    assertEquals(
      (resolved[0].payload as { sources: { service: { layer: string } } }).sources.service.layer,
      "cli",
    );
    const lock = join(tempDir, config.paths.runtime, "bindings", `${traceId}.lock.json`);
    assertEquals((await Deno.stat(lock)).isFile, true);
  } finally {
    await cleanup();
  }
});

Deno.test("[replay] a drifted --locked lock fails the run before any provider call", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const { factory, logger, config, runner } = await harness(tempDir, db);
    const first = crypto.randomUUID();
    const store = new RunBindingsStore(config);
    await store.write(runFile(first, {
      binds: [{ selector: "default", spec: { service: "alpha", model: "mock/alpha" } }],
    }));
    await runner.execute(flow, {
      userPrompt: "a",
      traceId: first,
      requestPath: REQUEST_PATH,
      requestSha256: REQUEST_SHA,
    });
    const lockPath = join(tempDir, config.paths.runtime, "bindings", `${first}.lock.json`);
    const lockText = await Deno.readTextFile(lockPath);

    const replay = crypto.randomUUID();
    await store.write(runFile(replay, {
      binds: [{ selector: "default", spec: { service: "beta", model: "mock/beta" } }],
      locked: JSON.parse(lockText),
    }));
    factory.calls.length = 0;
    const result = await runner.execute(flow, {
      userPrompt: "b",
      traceId: replay,
      requestPath: REQUEST_PATH,
      requestSha256: REQUEST_SHA,
    });
    assertEquals(result.success, false);
    assertEquals(factory.calls, []);
    const rejected = logger.events.filter((event) => event.action === "binding.rejected");
    assertEquals(rejected.length, 1);
    assertStringIncludes(JSON.stringify(rejected[0].payload), "lock_mismatch");
  } finally {
    await cleanup();
  }
});
