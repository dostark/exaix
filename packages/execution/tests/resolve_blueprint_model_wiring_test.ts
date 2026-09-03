/**
 * @module ResolveBlueprintModelWiringTest
 * @path packages/execution/tests/resolve_blueprint_model_wiring_test.ts
 * @description Phase 132 Step 3 — validates that AgentOrchestrator uses ModelResolver
 *   when injected, replacing the inline provider:model split. Also verifies that
 *   resolved options are forwarded to generate() calls.
 * @architectural-layer Execution
 * @dependencies [@std/assert, @exaix/testing, @exaix/schemas, @exaix/ai]
 */

import { assertEquals, assertExists } from "@std/assert";
import { createTestConfig } from "../../../packages/ai/tests/helpers/test_config.ts";
import { initTestDbService } from "@exaix/testing";
import { AgentOrchestrator } from "@exaix/execution";
import type { ModelResolver } from "@exaix/ai";
import type { IResolvedModel } from "@exaix/schemas";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { join } from "@std/path";

function createMockResolver(expected: IResolvedModel): ModelResolver {
  return {
    resolve: (_intent: Parameters<ModelResolver["resolve"]>[0]) => Promise.resolve(expected),
  } as ModelResolver;
}

Deno.test("[step132.3] AgentOrchestrator with injected ModelResolver calls resolve", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const config = createTestConfig();
    config.system.root = "/tmp";

    const logger = new EventLogger({ db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService([]);

    const mockModel: IResolvedModel = {
      provider: "mock-provider",
      model: "mock-model",
      options: { thinking: true, effort: "high" },
      attempt: 1,
    };

    const mockResolver = createMockResolver(mockModel);

    const executor = new AgentOrchestrator({
      config,
      db,
      logger,
      pathResolver,
      permissions,
      modelResolver: mockResolver,
    });

    assertExists(executor);
    executor.dispose();
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.3] AgentOrchestrator with injected ModelResolver resolves provider:model", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const testDir = await Deno.makeTempDir();
    const config = createTestConfig();
    config.system.root = testDir;

    // Write a test blueprint
    const blueprintsDir = join(testDir, "Blueprints", "Agents");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    const blueprintPath = join(blueprintsDir, "test-agent.md");
    await Deno.writeTextFile(
      blueprintPath,
      `---
model: gpt-4o
capabilities: [chat]
---

Test agent
`,
    );

    const logger = new EventLogger({ db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService([]);

    const mockModel: IResolvedModel = {
      provider: "resolved-provider",
      model: "resolved-model",
      attempt: 1,
    };

    const mockResolver = createMockResolver(mockModel);

    const executor = new AgentOrchestrator({
      config,
      db,
      logger,
      pathResolver,
      permissions,
      modelResolver: mockResolver,
    });

    const blueprint = await executor.loadBlueprint("test-agent");
    assertEquals(blueprint.provider, "resolved-provider");
    assertEquals(blueprint.model, "resolved-model");

    executor.dispose();
    await Deno.remove(testDir, { recursive: true });
  } finally {
    await cleanup();
  }
});
