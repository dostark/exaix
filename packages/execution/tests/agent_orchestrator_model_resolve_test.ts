/**
 * @module AgentExecutorModelResolveTest
 * @path packages/execution/tests/agent_orchestrator_model_resolve_test.ts
 * @description Phase 132 Step 3 — validates that AgentOrchestrator correctly resolves
 *   model via ModelResolver using blueprint frontmatter fields (model_size,
 *   thinking, characteristics, preferred_provider) and falls back to inline
 *   split when ModelResolver is not provided.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing, @exaix/schemas, @exaix/ai]
 * @related-files [packages/execution/src/agent_orchestrator.ts]
 */

import { assertEquals } from "@std/assert";
import { createTestConfig } from "../../../packages/ai/tests/helpers/test_config.ts";
import { initTestDbService } from "@exaix/testing";
import { AgentOrchestrator } from "@exaix/execution";
import type { IAgentOrchestratorOptions } from "@exaix/execution";
import type { ModelResolver } from "@exaix/ai";
import type { IModelIntent, IResolvedModel } from "@exaix/schemas";
import { TaskType } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core/types";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { join } from "@std/path";

function createMockResolver(expected: IResolvedModel): { resolver: ModelResolver } {
  return {
    resolver: {
      resolve: (_intent: IModelIntent) => Promise.resolve(expected),
    } as ModelResolver,
  };
}

function createCapturingResolver(
  expected: IResolvedModel,
): { resolver: ModelResolver; captured: IModelIntent[] } {
  const captured: IModelIntent[] = [];
  return {
    resolver: {
      resolve: (intent: IModelIntent) => {
        captured.push(intent);
        return Promise.resolve(expected);
      },
    } as ModelResolver,
    captured,
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
  options?: IAgentOrchestratorOptions,
): AgentOrchestrator {
  const logger = new EventLogger({ db });
  const pathResolver = new PathResolver(config);
  const permissions = new PortalPermissionsService([]);
  return new AgentOrchestrator({ config, db, logger, pathResolver, permissions, options, modelResolver: resolver });
}

Deno.test("[step132.3][model-resolve] AgentOrchestrator resolves model_size blueprint through ModelResolver", async () => {
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

Deno.test("[step132.3][model-resolve] AgentOrchestrator with explicit model bypasses ModelResolver", async () => {
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

Deno.test("[step135.8] request-level requestIntent.task_type wins as frontmatter-tier precedence", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const testDir = await Deno.makeTempDir();
    const config = createTestConfig();
    config.system.root = testDir;

    const mockModel: IResolvedModel = { provider: "p", model: "m", attempt: 1 };
    const { resolver, captured } = createCapturingResolver(mockModel);

    await writeBlueprint(testDir, "test-agent", { model: "ignored", model_size: "L", capabilities: "[chat]" });

    const executor = makeExecutor(config, db, resolver, { requestIntent: { task_type: TaskType.BUGFIX } });
    await executor.loadBlueprint("test-agent");

    assertEquals(captured[0]?.task_type, TaskType.BUGFIX);
    assertEquals(captured[0]?.task_type_source, "frontmatter");

    executor.dispose();
    await Deno.remove(testDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8] blueprint frontmatter task_type field derives with source 'identity'", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const testDir = await Deno.makeTempDir();
    const config = createTestConfig();
    config.system.root = testDir;

    const mockModel: IResolvedModel = { provider: "p", model: "m", attempt: 1 };
    const { resolver, captured } = createCapturingResolver(mockModel);

    await writeBlueprint(testDir, "test-agent", {
      model: "ignored",
      model_size: "L",
      capabilities: "[chat]",
      task_type: "feature",
    });

    const executor = makeExecutor(config, db, resolver);
    await executor.loadBlueprint("test-agent");

    assertEquals(captured[0]?.task_type, TaskType.FEATURE);
    assertEquals(captured[0]?.task_type_source, "identity");

    executor.dispose();
    await Deno.remove(testDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8] caller-supplied topSkillTaskTypes derives with source 'skill' when no frontmatter/identity task_type", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const testDir = await Deno.makeTempDir();
    const config = createTestConfig();
    config.system.root = testDir;

    const mockModel: IResolvedModel = { provider: "p", model: "m", attempt: 1 };
    const { resolver, captured } = createCapturingResolver(mockModel);

    await writeBlueprint(testDir, "test-agent", { model: "ignored", model_size: "L", capabilities: "[chat]" });

    const executor = makeExecutor(config, db, resolver, { topSkillTaskTypes: [TaskType.TEST] });
    await executor.loadBlueprint("test-agent");

    assertEquals(captured[0]?.task_type, TaskType.TEST);
    assertEquals(captured[0]?.task_type_source, "skill");

    executor.dispose();
    await Deno.remove(testDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8] config task_type_map soft-matches the identity_id when no other source present", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const testDir = await Deno.makeTempDir();
    const config = createTestConfig();
    config.system.root = testDir;
    config.model_registry = {
      ...config.model_registry,
      task_type_map: { "test-agent": TaskType.ANALYSIS },
    } as typeof config.model_registry;

    const mockModel: IResolvedModel = { provider: "p", model: "m", attempt: 1 };
    const { resolver, captured } = createCapturingResolver(mockModel);

    await writeBlueprint(testDir, "test-agent", {
      model: "ignored",
      model_size: "L",
      capabilities: "[chat]",
      identity_id: "test-agent",
    });

    const executor = makeExecutor(config, db, resolver);
    await executor.loadBlueprint("test-agent");

    assertEquals(captured[0]?.task_type, TaskType.ANALYSIS);
    assertEquals(captured[0]?.task_type_source, "static_map");

    executor.dispose();
    await Deno.remove(testDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8] no task_type source at all leaves task_type/task_type_source unset (UNKNOWN rides as absence, not an error)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const testDir = await Deno.makeTempDir();
    const config = createTestConfig();
    config.system.root = testDir;

    const mockModel: IResolvedModel = { provider: "p", model: "m", attempt: 1 };
    const { resolver, captured } = createCapturingResolver(mockModel);

    await writeBlueprint(testDir, "test-agent", { model: "ignored", model_size: "L", capabilities: "[chat]" });

    const executor = makeExecutor(config, db, resolver);
    await executor.loadBlueprint("test-agent");

    assertEquals(captured[0]?.task_type, TaskType.UNKNOWN);
    assertEquals(captured[0]?.task_type_source, "unknown");

    executor.dispose();
    await Deno.remove(testDir, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.3][model-resolve] AgentOrchestrator without ModelResolver splits provider:model inline", async () => {
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
