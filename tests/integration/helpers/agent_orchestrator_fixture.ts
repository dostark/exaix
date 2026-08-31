/**
 * @module AgentExecutorFixture
 * @path tests/integration/helpers/agent_orchestrator_fixture.ts
 * @related-files ["tests/integration/agent/cost_logging_test.ts", "tests/integration/agent/context_overflow_recovery_test.ts"]
 * @description Shared fixture for AgentOrchestrator integration tests: temp DB, a
 * git-initialised TestPortal, a test-agent blueprint, and wired config,
 * logger, path resolver, and portal permissions.
 */

import { join } from "@std/path";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { PortalOperation } from "@exaix/core";
import type { Config } from "@exaix/schemas/config.ts";
import type { DatabaseService } from "@exaix/storage-sqlite";
import { createTestConfig } from "../../../packages/ai/tests/helpers/test_config.ts";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { initTestDbService } from "@exaix/testing";

export interface IAgentExecutorFixture {
  db: DatabaseService;
  tempDir: string;
  config: Config;
  logger: EventLogger;
  pathResolver: PathResolver;
  permissions: PortalPermissionsService;
  cleanup: () => Promise<void>;
}

/** Creates a temp workspace with a git-initialised TestPortal, a test-agent blueprint, and an AgentOrchestrator-ready config + service wiring. */
export async function setupAgentExecutorFixture(): Promise<IAgentExecutorFixture> {
  const { db, tempDir, cleanup } = await initTestDbService();

  const portalDir = join(tempDir, "TestPortal");
  const blueprintsDir = join(tempDir, "Blueprints", "Identities");
  await Deno.mkdir(portalDir, { recursive: true });
  await Deno.mkdir(blueprintsDir, { recursive: true });

  await new Deno.Command("git", { args: ["init"], cwd: portalDir }).output();
  await new Deno.Command("git", { args: ["config", "user.name", "Test User"], cwd: portalDir }).output();
  await new Deno.Command("git", { args: ["config", "user.email", "test@exaix.local"], cwd: portalDir }).output();
  await Deno.writeTextFile(join(portalDir, "README.md"), "# Test\n");
  await new Deno.Command("git", { args: ["add", "README.md"], cwd: portalDir }).output();
  await new Deno.Command("git", { args: ["commit", "-m", "init"], cwd: portalDir }).output();

  await Deno.writeTextFile(
    join(blueprintsDir, "test-agent.md"),
    "---\nname: test-agent\nmodel: gpt-4o-mini\nprovider: openai\ncapabilities: []\n---\nYou are a test agent.",
  );

  const config = createTestConfig();
  config.system.root = tempDir;
  config.paths = {
    ...config.paths,
    workspace: join(tempDir, "Workspace"),
    memory: join(tempDir, "Memory"),
    runtime: join(tempDir, ".exa"),
    blueprints: join(tempDir, "Blueprints"),
  };
  config.portals = [
    {
      alias: "TestPortal",
      target_path: portalDir,
      default_branch: TEST_DEFAULT_BRANCH,
      identities_allowed: ["*"],
      operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
    },
  ];

  const logger = new EventLogger({ db });
  const pathResolver = new PathResolver(config);
  const permissions = new PortalPermissionsService(config.portals);

  return { db, tempDir, config, logger, pathResolver, permissions, cleanup };
}
