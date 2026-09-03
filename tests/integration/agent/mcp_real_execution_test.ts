/**
 * @module McpRealExecutionTest
 * @path tests/integration/agent/mcp_real_execution_test.ts
 * @description Integration tests for real-world MCP execution, including tool bridging,
 * real git SHA capture, and security audit/revert logic.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { AgentOrchestrator } from "@exaix/execution";
import { StrategyRegistry } from "@exaix/execution";
import { McpAgentStrategy } from "@exaix/execution";
import { ProcessManager } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { SecurityMode } from "@exaix/core";
import type { IPortalPermissions } from "@exaix/schemas/portal_permissions.ts";
import { ToolRegistryTestHelper } from "../../../packages/tool-runtime/tests/helpers/tool_registry_test_helper.ts";
import { ToolRegistry } from "@exaix/tool-runtime";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { readFixtureTextSync } from "@exaix/testing";

Deno.test("AgentOrchestrator Integration - Real MCP Execution & Audit", async () => {
  const helper = await ToolRegistryTestHelper.create("mcp-real-exec");

  const portalPath = join(helper.tempDir, "portal-test");
  await Deno.mkdir(portalPath, { recursive: true });

  const gitInit = new Deno.Command("git", {
    args: ["init", "-b", TEST_DEFAULT_BRANCH],
    cwd: portalPath,
    stdout: "null",
  });
  await gitInit.output();

  await new Deno.Command("git", {
    args: ["config", "user.name", "Test User"],
    cwd: portalPath,
    stdout: "null",
  }).output();

  await new Deno.Command("git", {
    args: ["config", "user.email", "test@example.com"],
    cwd: portalPath,
    stdout: "null",
  }).output();

  await Deno.writeTextFile(join(portalPath, "README.md"), "# Test\n");
  await new Deno.Command("git", {
    args: ["add", "."],
    cwd: portalPath,
    stdout: "null",
  }).output();

  await new Deno.Command("git", {
    args: ["commit", "-m", "Initial"],
    cwd: portalPath,
    stdout: "null",
  }).output();

  // Update config with portal
  const registryState = { config: helper.config };
  const portalConfig: IPortalPermissions = {
    alias: "test",
    target_path: portalPath,
    default_branch: TEST_DEFAULT_BRANCH,
    agents_allowed: ["*"],
    operations: [],
  };
  registryState.config.portals = [portalConfig];

  const processManager = new ProcessManager();
  const pathResolver = new PathResolver(registryState.config);
  const permissions = new PortalPermissionsService([portalConfig]);

  const strategyRegistry = new StrategyRegistry();
  const logger = new EventLogger({ db: helper.db, defaultActor: "user:test" });
  const toolRegistry = new ToolRegistry({ config: registryState.config, logger, pathResolver });

  const executor = new AgentOrchestrator({
    config: registryState.config,
    db: helper.db,
    logger,
    pathResolver,
    permissions,
    strategyRegistry,
    toolRegistry,
  });

  // Set environment variable for mock agent and register strategy
  Deno.env.set("EXAIX_AGENT_ENTRYPOINT", "tests/integration/agent/mock_agent.ts");
  strategyRegistry.register(new McpAgentStrategy(executor, processManager));

  // Setup Blueprint directory
  const blueprintsDir = helper.registry["config"].paths.blueprints;
  const systemRoot = helper.registry["config"].system.root;
  const blueprintsDirAbs = blueprintsDir.startsWith("/") ? blueprintsDir : join(systemRoot, blueprintsDir);
  const identitiesDir = join(blueprintsDirAbs, "Agents");
  await Deno.mkdir(identitiesDir, { recursive: true });

  // Create a blueprint that allows write_file but restricts paths
  const fixture_1 = readFixtureTextSync(
    import.meta.url,
    "integration",
    "agent",
    "mcp_real_execution_test",
    "fixture_1.md",
  );
  await Deno.writeTextFile(join(identitiesDir, "test-agent.md"), fixture_1);

  try {
    // 1. Test Authorized Write
    const result1 = await executor.executeStep(
      {
        trace_id: crypto.randomUUID(),
        request_id: "REQ1",
        request: "write_authorized",
        plan: "Write authorized file",
        portal: "test",
      },
      {
        agent_role: "test-agent",
        portal: "test",
        security_mode: SecurityMode.HYBRID,
      },
    );

    assertEquals(await Deno.readTextFile(join(portalPath, "authorized.txt")), "this is authorized");

    // Captured SHA should be the current HEAD
    const headSha = await executor.getPortalHeadSha(portalPath);
    assertEquals(result1.commit_sha, headSha);

    // 2. Test Unauthorized Write (Audit & Revert)
    await assertRejects(
      async () => {
        await executor.executeStep(
          {
            trace_id: crypto.randomUUID(),
            request_id: "REQ2",
            request: "write_unauthorized",
            plan: "Attempt unauthorized write",
            portal: "test",
          },
          {
            agent_role: "test-agent",
            portal: "test",
            security_mode: SecurityMode.HYBRID,
          },
        );
      },
      Error,
      "Security violation",
    );

    // Verify that unauthorized.txt was reverted (deleted since it was untracked)
    try {
      await Deno.stat(join(portalPath, "unauthorized.txt"));
      throw new Error("unauthorized.txt should have been deleted by audit revert");
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  } finally {
    processManager.cleanup();
    await helper.cleanup();
  }
});
