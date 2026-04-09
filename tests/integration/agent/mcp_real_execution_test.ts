/**
 * @module McpRealExecutionTest
 * @path tests/integration/agent/mcp_real_execution_test.ts
 * @description Integration tests for real-world MCP execution, including tool bridging,
 * real git SHA capture, and security audit/revert logic.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { AgentExecutor } from "../../../src/services/agent/agent_executor.ts";
import { StrategyRegistry } from "../../../src/services/agent/strategies/strategy_registry.ts";
import { McpAgentStrategy } from "../../../src/services/agent/strategies/mcp_agent_strategy.ts";
import { ProcessManager } from "../../../src/services/agent/process_manager.ts";
import { EventLogger } from "../../../src/services/core/event_logger.ts";
import { PortalPermissionsService } from "../../../src/services/portal/portal_permissions.ts";
import { PathResolver } from "../../../src/services/portal/path_resolver.ts";
import { SecurityMode } from "../../../src/shared/enums.ts";
import type { IPortalPermissions } from "../../../src/shared/schemas/portal_permissions.ts";
import { ToolRegistryTestHelper } from "../../helpers/tool_registry_test_helper.ts";
import { TEST_DEFAULT_BRANCH } from "../../helpers/constants.ts";

Deno.test("AgentExecutor Integration - Real MCP Execution & Audit", async () => {
  const helper = await ToolRegistryTestHelper.create("mcp-real-exec");

  // Use ToolRegistryTestHelper's config and env to setup portal
  // Wait! ToolRegistryTestHelper doesn't have TestEnvironment.
  // But we can use setupPortal if we import it or use a raw setup.
  // Actually, ToolRegistryTestHelper already provides a temp directory.

  const portalPath = join(helper.tempDir, "portal-test");
  await Deno.mkdir(portalPath, { recursive: true });

  // Initialize git repo in portal manually here since we are not using TestEnvironment
  // OR we can refactor ToolRegistryTestHelper to use TestEnvironment?
  // For now, let's just keep the localized setup but standardize it.

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
    identities_allowed: ["*"],
    operations: [],
  };
  registryState.config.portals = [portalConfig];

  const processManager = new ProcessManager();
  const pathResolver = new PathResolver(registryState.config);
  const permissions = new PortalPermissionsService([portalConfig]);

  const strategyRegistry = new StrategyRegistry();
  const logger = new EventLogger({ db: helper.db, defaultActor: "test" });

  const executor = new AgentExecutor(
    registryState.config,
    helper.db,
    logger,
    pathResolver,
    permissions,
    undefined, // provider
    strategyRegistry,
    helper.registry, // toolRegistry
  );

  // Set environment variable for mock agent and register strategy
  Deno.env.set("EXAIX_AGENT_ENTRYPOINT", "tests/integration/agent/mock_agent.ts");
  strategyRegistry.register(new McpAgentStrategy(executor, processManager));

  // Setup Blueprint directory
  const blueprintsDir = helper.registry["config"].paths.blueprints;
  const systemRoot = helper.registry["config"].system.root;
  const blueprintsDirAbs = blueprintsDir.startsWith("/") ? blueprintsDir : join(systemRoot, blueprintsDir);
  const identitiesDir = join(blueprintsDirAbs, "Identities");
  await Deno.mkdir(identitiesDir, { recursive: true });

  // Create a blueprint that allows write_file but restricts paths
  await Deno.writeTextFile(
    join(identitiesDir, "test-agent.md"),
    `---
identity_id: test-agent
name: test-agent
model: gpt-4
provider: openai
capabilities: ["mcp", "write"]
permitted_tools: ["write_file"]
allowed_paths: ["authorized.txt"]
---
You are a test agent.`,
  );

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
        identity_id: "test-agent",
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
            identity_id: "test-agent",
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
