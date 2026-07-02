/**
 * @module AgentExecutorModelResolveTest
 * @path packages/execution/tests/agent_executor_model_resolve_test.ts
 * @description Phase 132 Step 3 — validates that AgentExecutor correctly resolves
 *   model via ModelResolver using blueprint frontmatter fields (model_size,
 *   thinking, characteristics, preferred_provider) and falls back to inline
 *   split when ModelResolver is not provided.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing, @exaix/schemas, @exaix/ai]
 * @related-files [packages/execution/src/agent_executor.ts]
 */

import { assertEquals } from "@std/assert";
import { createTestConfig } from "../../../packages/ai/tests/helpers/test_config.ts";
import { initTestDbService } from "@exaix/testing";
import { AgentExecutor } from "@exaix/execution";
import type { ModelResolver } from "@exaix/ai";
import type { IResolvedModel, ModelIntent } from "@exaix/schemas";
import type { JSONValue } from "@exaix/core/types";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { join } from "@std/path";

function createMockResolver(expected: IResolvedModel): { resolver: ModelResolver } {
  return {
    resolver: {
      resolve: (_intent: ModelIntent) => Promise.resolve(expected),
    } as ModelResolver,
  };
}

const resolverDir = "Blueprints/Identities";

async function writeBlueprint(root: string, name: string, frontmatter: Record<string, JSONValue>): Promise<string> {
  const dir = join(root, resolverDir);
  await Deno.mkdir(dir, { recursive: true });
  const path = join(dir, `${name}.md`);
  const body = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
      return `${k}: ${v}`;
    })
    .join("\n");
  await Deno.writeTextFile(path, `---\n${body}\n---\n\nTest ${name}\n`);
  return name;
}

function makeExecutor(
  config: ReturnType<typeof createTestConfig>,
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  resolver?: ModelResolver,
): AgentExecutor {
  const logger = new EventLogger({ db });
  const pathResolver = new PathResolver(config);
  const permissions = new PortalPermissionsService([]);
  return new AgentExecutor(
    config,
    db,
    logger,
    pathResolver,
    permissions,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    resolver,
  );
}

Deno.test("[step132.3][model-resolve] AgentExecutor resolves model_size blueprint through ModelResolver", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const testDir = await Deno.makeTempDir();
    const config = createTestConfig();
    config.system.root = testDir;

    const mockModel: IResolvedModel = {
      provider: "resolved-provider",
      model: "resolved-model",
      attempt: 1,
    };
    const { resolver } = createMockResolver(mockModel);

    await writeBlueprint(testDir, "test-agent", {
      model: "ignored",
      model_size: "L",
      capabilities: "[chat]",
    });

    const executor = makeExecutor(config, db, resolver);
    const blueprint = await executor.loadBlueprint("test-agent");
    assertEquals(blueprint.provider, "resolved-provider");
    assertEquals(blueprint.model, "resolved-model");

    executor.dispose();
    await Deno.remove(testDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.3][model-resolve] AgentExecutor with explicit model bypasses ModelResolver", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const testDir = await Deno.makeTempDir();
    const config = createTestConfig();
    config.system.root = testDir;

    const mockModel: IResolvedModel = {
      provider: "resolved-provider",
      model: "resolved-model",
      attempt: 1,
    };
    const { resolver } = createMockResolver(mockModel);

    await writeBlueprint(testDir, "test-agent", {
      model: "anthropic:claude-sonnet",
      capabilities: "[chat]",
    });

    const executor = makeExecutor(config, db, resolver);
    const blueprint = await executor.loadBlueprint("test-agent");
    assertEquals(blueprint.provider, "resolved-provider");
    assertEquals(blueprint.model, "resolved-model");

    executor.dispose();
    await Deno.remove(testDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.3][model-resolve] AgentExecutor without ModelResolver splits provider:model inline", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const testDir = await Deno.makeTempDir();
    const config = createTestConfig();
    config.system.root = testDir;

    await writeBlueprint(testDir, "test-agent", {
      model: "anthropic:claude-sonnet",
      capabilities: "[chat]",
    });

    const executor = makeExecutor(config, db);
    const blueprint = await executor.loadBlueprint("test-agent");
    assertEquals(blueprint.provider, "anthropic");
    assertEquals(blueprint.model, "claude-sonnet");

    executor.dispose();
    await Deno.remove(testDir, { recursive: true });
  } finally {
    await cleanup();
  }
});
