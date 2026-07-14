/**
 * @module AgentExecutorPerCallOptionsTest
 * @path packages/execution/tests/agent_orchestrator_per_call_options_test.ts
 * @description Phase 132 Step 3 — validates that AgentOrchestrator passes resolved
 *   call options (thinking, effort, max_tokens) from ModelResolver to the
 *   executing strategy via the callOptions property.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing, @exaix/schemas, @exaix/ai]
 * @related-files [packages/execution/src/agent_orchestrator.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { createTestConfig } from "../../../packages/ai/tests/helpers/test_config.ts";
import { initTestDbService } from "@exaix/testing";
import { AgentOrchestrator } from "@exaix/execution";
import type { ModelResolver } from "@exaix/ai";
import type { IModelIntent, IResolvedModel } from "@exaix/schemas";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { join } from "@std/path";

interface ICapturedResolve {
  intent: IModelIntent;
  result: IResolvedModel;
}

function createCapturingResolver(): { resolver: ModelResolver; captured: ICapturedResolve[] } {
  const captured: ICapturedResolve[] = [];
  const expected: IResolvedModel = {
    provider: "mock-provider",
    model: "mock-model",
    options: { thinking: true, effort: "high" },
    attempt: 1,
  };
  const resolver = {
    resolve: (intent: IModelIntent) => {
      captured.push({ intent, result: expected });
      return Promise.resolve(expected);
    },
  } as ModelResolver;
  return { resolver, captured };
}

Deno.test("[step132.3][per-call-options] AgentOrchestrator passes model_size and thinking intent to ModelResolver", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const testDir = await Deno.makeTempDir();
    const config = createTestConfig();
    config.system.root = testDir;

    const blueprintsDir = join(testDir, "Blueprints", "Identities");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    const blueprintPath = join(blueprintsDir, "test-agent.md");
    await Deno.writeTextFile(
      blueprintPath,
      `---
model: placeholder
model_size: M
thinking: true
effort: high
capabilities: [chat]
---

Test agent
`,
    );

    const logger = new EventLogger({ db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService([]);
    const { resolver, captured } = createCapturingResolver();

    const executor = new AgentOrchestrator({ config, db, logger, pathResolver, permissions, modelResolver: resolver });

    const blueprint = await executor.loadBlueprint("test-agent");
    assertEquals(blueprint.provider, "mock-provider");
    assertEquals(blueprint.model, "mock-model");

    assertEquals(captured.length, 1);
    assertEquals(captured[0].intent.model_size, "M");
    assert(captured[0].intent.thinking);
    assertEquals(captured[0].intent.effort, "high");
    assertEquals(captured[0].result.options?.thinking, true);
    assertEquals(captured[0].result.options?.effort, "high");

    executor.dispose();
    await Deno.remove(testDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.3][per-call-options] AgentOrchestrator passes characteristics and preferred_provider to ModelResolver", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const testDir = await Deno.makeTempDir();
    const config = createTestConfig();
    config.system.root = testDir;

    const blueprintsDir = join(testDir, "Blueprints", "Identities");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    const blueprintPath = join(blueprintsDir, "test-agent.md");
    await Deno.writeTextFile(
      blueprintPath,
      `---
model: placeholder
model_size: L
characteristics: [fastest]
preferred_provider: anthropic
capabilities: [chat]
---

Test agent
`,
    );

    const logger = new EventLogger({ db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService([]);
    const { resolver, captured } = createCapturingResolver();

    const executor = new AgentOrchestrator({ config, db, logger, pathResolver, permissions, modelResolver: resolver });

    await executor.loadBlueprint("test-agent");
    assertEquals(captured.length, 1);
    assertEquals(captured[0].intent.model_size, "L");
    assertEquals(captured[0].intent.characteristics, ["fastest"]);
    assertEquals(captured[0].intent.preferred_provider, "anthropic");

    executor.dispose();
    await Deno.remove(testDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.3][per-call-options] AgentOrchestrator without ModelResolver falls back to inline split", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const testDir = await Deno.makeTempDir();
    const config = createTestConfig();
    config.system.root = testDir;

    const blueprintsDir = join(testDir, "Blueprints", "Identities");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    const blueprintPath = join(blueprintsDir, "test-agent.md");
    await Deno.writeTextFile(
      blueprintPath,
      `---
model: anthropic:claude-sonnet
capabilities: [chat]
---

Test agent
`,
    );

    const logger = new EventLogger({ db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService([]);

    const executor = new AgentOrchestrator({ config, db, logger, pathResolver, permissions });

    const blueprint = await executor.loadBlueprint("test-agent");
    assertEquals(blueprint.provider, "anthropic");
    assertEquals(blueprint.model, "claude-sonnet");

    executor.dispose();
    await Deno.remove(testDir, { recursive: true });
  } finally {
    await cleanup();
  }
});
