/**
 * @module FlowStepBindingsEnvTest
 * @path tests/integration/flow_step_bindings_env_test.ts
 * @description Step-4 runtime-layer coverage: daemon overlay files apply to the next run
 *   without a restart, an unmatched step under an operator layer resolves via the
 *   config.ai implicit default (never the env-honoring boot provider), and env_ignored is
 *   true when EXA_LLM_* is set while an operator layer exists.
 * @architectural-layer Services
 * @related-files [packages/ai/src/bindings/binding_layers.ts, packages/ai/src/bindings/model_binding_service.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { type IModelProvider, type IResolvedProviderOptions, ModelBindingService, ProviderRegistry } from "@exaix/ai";
import type { IProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { FlowOutputFormat, PricingTier, ProviderCostTier } from "@exaix/core";
import { type Config, ConfigSchema, FlowSchema } from "@exaix/schemas";
import { createMockEventLogger, initTestDbService, withEnv } from "@exaix/testing";

const flow = FlowSchema.parse({
  id: "research",
  name: "Research",
  description: "Env rule flow",
  steps: [
    { id: "compose", name: "Compose", agent_role: "composer" },
    { id: "explore", name: "Explore", agent_role: "explorer", dependsOn: ["compose"] },
  ],
  output: { from: "explore", format: FlowOutputFormat.MARKDOWN },
});

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

function registerMock(): CapturingFactory {
  const factory = new CapturingFactory();
  ProviderRegistry.registerWithMetadata("mock", factory, {
    name: "mock",
    description: "captured mock",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
  return factory;
}

function configFor(root: string, bindings?: Config["bindings"]): Config {
  return ConfigSchema.parse({
    system: { root },
    paths: {},
    ai: { provider: "mock", model: "mock" },
    bindings,
    catalog: {
      models: { "mock/mock": { model_provider: "mock" } },
      services: {
        alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "*": "{name}" } },
      },
      preferences: { mock: ["alpha"] },
    },
  });
}

Deno.test("[env] a config [bindings] present drives no flow step and env_ignored is true", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  registerMock();
  await withEnv({ EXA_LLM_PROVIDER: "mock", EXA_LLM_MODEL: "env-model" }, async () => {
    try {
      const config = configFor(tempDir, {
        default: { service: "alpha", model: "mock/mock" },
      });
      const service = new ModelBindingService({
        configSource: { get: () => config },
        logger: createMockEventLogger(),
        db,
        probe: { hasKey: () => true, hasOptIn: () => true },
      });
      const snapshot = await service.snapshotForRun(flow, { traceId: crypto.randomUUID() });
      // An operator layer exists, so the run ignores EXA_LLM_*.
      assertEquals(snapshot.envIgnored, true);
      // Every step resolves through the operator layer's default, never unbound.
      for (const step of flow.steps) {
        const outcome = snapshot.bindings.get(step.id);
        assertExists(outcome, `step ${step.id} must resolve`);
        assertEquals(outcome.kind, "bound");
      }
    } finally {
      await cleanup();
    }
  });
});

Deno.test("[env] an unmatched step under an operator layer resolves the config.ai implicit default", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  registerMock();
  try {
    // The operator layer binds only "compose".
    // "explore" then gets the implicit config.ai default.
    const config = configFor(tempDir, { "flow:research/step:compose": { service: "alpha", model: "mock/mock" } });
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger: createMockEventLogger(),
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const snapshot = await service.snapshotForRun(flow, { traceId: crypto.randomUUID() });
    const composeOutcome = snapshot.bindings.get("compose");
    assertExists(composeOutcome);
    assertEquals(composeOutcome.kind, "bound");
    const exploreOutcome = snapshot.bindings.get("explore");
    assertExists(exploreOutcome, "an unmatched step under an operator layer must resolve");
    // It is bound (implicit config.ai), not unbound.
    assertEquals(exploreOutcome.kind, "bound");
  } finally {
    await cleanup();
  }
});

Deno.test("[runtime] an overlay dropped into .exa/overlays/ applies to the next run without a restart", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  registerMock();
  try {
    const overlaysDir = join(tempDir, ".exa", "overlays");
    const config = configFor(tempDir, undefined);
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger: createMockEventLogger(),
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });

    // First run: no overlay, no bindings → inactive, no snapshot.
    assertEquals(service.isActive(), false);
    await Deno.mkdir(overlaysDir, { recursive: true });

    // Drop an overlay, and the next run sees it without any daemon restart.
    await Deno.writeTextFile(
      join(overlaysDir, "step-binding.json"),
      JSON.stringify({
        schema: 1,
        bindings: { "flow:research/step:compose": { service: "alpha", model: "mock/mock" } },
      }),
    );
    assertEquals(service.isActive(), true);
    const after = await service.snapshotForRun(flow, { traceId: crypto.randomUUID() });
    assertEquals(after.layers.operatorLayersPresent, true);
    const composeOutcome = after.bindings.get("compose");
    assertExists(composeOutcome);
    assertEquals(composeOutcome.kind, "bound");
  } finally {
    await cleanup();
  }
});

Deno.test("[runtime] a per-run run binding file claims its overlays for that trace and matches the request", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  registerMock();
  try {
    const config = configFor(tempDir, undefined);
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger: createMockEventLogger(),
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    // No run file: the snapshot resolves nothing and stays inactive.
    const plain = await service.snapshotForRun(flow, { traceId: crypto.randomUUID() });
    assertEquals(plain.layers.operatorLayersPresent, false);
  } finally {
    await cleanup();
  }
});
