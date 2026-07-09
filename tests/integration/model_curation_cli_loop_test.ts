/**
 * @module ModelCurationCliLoopTest
 * @path tests/integration/model_curation_cli_loop_test.ts
 * @description Phase 134 Step 6 integration — the full Solo curation loop:
 *   `ModelCommands.setCandidates` writes a curated provider list to exa.config.toml,
 *   `ConfigService` loads that TOML, and `ModelResolver` honours the list, emitting
 *   `reason: "preferred_list"`. Proves the CLI write surface and the resolver read
 *   surface are the same (config.model_presets) with zero DB.
 * @architectural-layer Integration
 * @related-files [apps/exactl/src/commands/model_commands.ts, packages/ai/src/model_resolver.ts, packages/core/src/config/service.ts]
 * @phase-134 Step 6 integration — full Solo curation loop reaching preferred_list.
 */

import { assertEquals } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { ConfigService } from "@exaix/core/config";
import { DefaultRoutingStrategy, ModelResolver, ProviderRegistry } from "@exaix/ai";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { writeTestConfigFile } from "@exaix/testing";
import { MockProviderFactory } from "../../packages/ai/src/factories/mock_factory.ts";
import { createStubCostTracker, createStubHealthChecker } from "../../packages/ai/tests/helpers/service_stubs.ts";
import { ModelCommands } from "../../apps/exactl/src/commands/model_commands.ts";

function registerProvider(name: string): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    contextWindow: 32_000,
  });
}

Deno.test("[integration] a list curated via config model is honoured by the next resolve (preferred_list)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "curation-loop-" });
  try {
    ProviderRegistry.clear();
    registerProvider("beta");
    registerProvider("gamma");

    // Seed a schema-valid config file the CLI curates and the resolver reads.
    const configPath = await writeTestConfigFile(dir);

    // 1. Curate via the CLI: prefer beta over gamma for size M.
    const registry = new DefaultModelRegistry(createStubHealthChecker());
    const cmd = new ModelCommands(registry, configPath);
    await cmd.setCandidates("M", ["beta", "gamma"]);

    // 2. Load the freshly written TOML the same way the daemon does.
    const config = new ConfigService(configPath).get();
    assertEquals(config.model_presets?.M?.candidates, ["beta", "gamma"]);

    // 3. Resolve a size-M intent — the curated list must win with preferred_list.
    const logger = createMockEventLogger();
    const resolver = new ModelResolver(
      new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
      config,
      createStubHealthChecker(),
      logger,
    );
    const result = await resolver.resolve({ model_size: "M" });

    assertEquals(result.provider, "beta");
    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(resolvedEvents.length >= 1, true);
    assertEquals(resolvedEvents[0].payload?.reason, "preferred_list");
  } finally {
    ProviderRegistry.clear();
    await Deno.remove(dir, { recursive: true });
  }
});
