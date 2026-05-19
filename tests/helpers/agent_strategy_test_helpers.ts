/**
 * @module AgentStrategyTestHelpers
 * @path tests/helpers/agent_strategy_test_helpers.ts
 * @description Shared test helpers for agent executor strategy integration tests.
 * @architectural-layer Tests
 */
import { join } from "@std/path";
import { initTestDbService } from "./db.ts";
import { createTestConfig } from "../../packages/ai/tests/helpers/test_config.ts";
import { EventLogger } from "@exaix/core/logger";
import { SecurityMode } from "@exaix/core";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { AgentExecutor } from "../../src/services/agent/agent_executor.ts";
import { readFixtureTextSync } from "./fixtures.ts";
import type { MockProvider } from "@exaix/ai/providers.ts";
import type { IAgentFileBlueprint } from "../../src/services/agent/agent_executor.ts";
import type { IAgentExecutionOptions } from "@exaix/schemas/agent_executor.ts";

export const TEST_OPTIONS: IAgentExecutionOptions = {
  identity_id: "test-agent",
  portal: "workspace",
  security_mode: SecurityMode.HYBRID,
  audit_enabled: true,
  timeout_ms: 30000,
  max_tool_calls: 10,
};

export const TEST_BLUEPRINT: IAgentFileBlueprint = {
  name: "test-agent",
  model: "mock-model",
  provider: "mock",
  capabilities: ["write"],
  allowed_paths: ["test.txt"],
  systemPrompt: "You are a test agent.",
};

export async function setupStrategyExecutor(
  tempDir: string,
  provider: MockProvider,
  fixturePath: { group: string; file: string },
): Promise<{
  executor: AgentExecutor;
  cleanup: () => Promise<void>;
}> {
  const { db, cleanup: dbCleanup } = await initTestDbService();
  const config = createTestConfig();
  config.system.root = tempDir;
  config.paths = {
    ...config.paths,
    workspace: join(tempDir, "Workspace"),
    blueprints: join(tempDir, "Blueprints"),
  };
  config.portals = [{
    alias: "workspace",
    target_path: tempDir,
    default_branch: "main",
    identities_allowed: ["*"],
    operations: [],
  }];

  const blueprintsDir = join(tempDir, "Blueprints", "Identities");
  await Deno.mkdir(blueprintsDir, { recursive: true });
  const fixture = readFixtureTextSync(import.meta.url, fixturePath.group, fixturePath.file, "fixture_1.md");
  await Deno.writeTextFile(join(blueprintsDir, "strategy-agent.md"), fixture);

  const logger = new EventLogger({ db });
  const pathResolver = new PathResolver(config);
  const permissions = new PortalPermissionsService(config.portals);
  const executor = new AgentExecutor(
    config,
    db,
    logger,
    pathResolver,
    permissions,
    provider,
  );

  return {
    executor,
    cleanup: async () => {
      executor.dispose();
      await dbCleanup();
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Best-effort tempdir cleanup for test isolation.
      }
    },
  };
}
