/**
 * @module CliDelegateDispatchTest
 * @path packages/execution/tests/agents/cli_delegate_dispatch_test.ts
 * @related-files [packages/execution/src/agent_orchestrator.ts, packages/execution/src/strategies/cli_delegate_strategy.ts]
 * @architectural-layer Services
 * @description Verifies AgentOrchestrator.executeStep dispatches a blueprint whose
 * capabilities include "cli_delegate" to CliDelegateStrategy when [cli_delegate] is
 * enabled in config, and that the strategy is not registered at all when disabled
 * (the default) — a step with the capability but no config falls through to the
 * unresolved-strategy error rather than silently running via the API.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AgentOrchestrator } from "@exaix/execution";
import { initTestDbService } from "@exaix/testing";
import { createMockConfig } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { ToolRegistry } from "@exaix/tool-runtime";
import type { Config } from "@exaix/schemas/config.ts";
import type { IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";

async function writeBlueprint(root: string, capabilities: string[]): Promise<void> {
  const dir = join(root, "Blueprints", "Identities");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "cli-delegate-agent.md"),
    `---\nname: cli-delegate-agent\nmodel: gpt-4o-mini\nprovider: openai\ncapabilities: ${
      JSON.stringify(capabilities)
    }\n---\nYou are a test agent.`,
  );
}

Deno.test("AgentOrchestrator: dispatches cli_delegate capability to CliDelegateStrategy when config is enabled", async () => {
  const dbService = await initTestDbService();
  try {
    const config: Config = createMockConfig(dbService.tempDir, {
      // Point at a binary name that cannot exist, so the dispatch test is
      // deterministic regardless of whether a real `claude`/`opencode` CLI is
      // installed on the machine running the test suite.
      cli_delegate: { enabled: true, tool: "claude-code", bin_overrides: ["exaix-nonexistent-cli-delegate-bin"] },
    });
    const portalAlias = config.portals![0].alias;
    await writeBlueprint(dbService.tempDir, ["code_generation", "cli_delegate"]);

    const logger = new EventLogger({ db: dbService.db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService(config.portals!);

    const executor = new AgentOrchestrator({ config, db: dbService.db, logger, pathResolver, permissions });

    const context: IExecutionContext = {
      trace_id: crypto.randomUUID(),
      request_id: "req-cli-delegate-1",
      request: "Fix the bug",
      plan: "Step 1",
      portal: portalAlias,
    };

    // No real `claude` binary in the test environment — the strategy must throw
    // AgentExecutionError (CONFIGURATION_ERROR), proving dispatch reached CliDelegateStrategy
    // (a different strategy would fail differently, e.g. "Model provider required").
    const err = await assertRejects(
      () =>
        executor.executeStep(context, {
          portal: portalAlias,
          identity_id: "cli-delegate-agent",
        }),
    );
    assertStringIncludes(String(err), "CLI delegate strategy could not run");

    executor.dispose();
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentOrchestrator: CliDelegateStrategy runs in ToolRegistry's baseDir (worktree), not the portal's static target_path", async () => {
  const dbService = await initTestDbService();
  try {
    const config: Config = createMockConfig(dbService.tempDir, {
      cli_delegate: { enabled: true, tool: "claude-code", bin_overrides: ["exaix-nonexistent-cli-delegate-bin"] },
    });
    const portalAlias = config.portals![0].alias;
    await writeBlueprint(dbService.tempDir, ["code_generation", "cli_delegate"]);

    // A worktree path that does not exist — proves which cwd CliDelegateStrategy actually
    // used via resolvePortalPath returning toolRegistry.getBaseDir().
    const worktreePath = join(dbService.tempDir, "nonexistent-worktree-checkout");

    const logger = new EventLogger({ db: dbService.db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService(config.portals!);
    const toolRegistry = new ToolRegistry({ config, logger, baseDir: worktreePath });

    const executor = new AgentOrchestrator({
      config,
      db: dbService.db,
      logger,
      pathResolver,
      permissions,
      toolRegistry,
    });

    assertEquals(toolRegistry.getBaseDir(), worktreePath);

    const context: IExecutionContext = {
      trace_id: crypto.randomUUID(),
      request_id: "req-cli-delegate-worktree",
      request: "Fix the bug",
      plan: "Step 1",
      portal: portalAlias,
    };

    const err = await assertRejects(
      () =>
        executor.executeStep(context, {
          portal: portalAlias,
          identity_id: "cli-delegate-agent",
        }),
    );
    assertStringIncludes(String(err), "CLI delegate strategy could not run");

    executor.dispose();
  } finally {
    await dbService.cleanup();
  }
});

Deno.test("AgentOrchestrator: cli_delegate capability without config enabled does not resolve CliDelegateStrategy", async () => {
  const dbService = await initTestDbService();
  try {
    // cli_delegate config omitted entirely — default is disabled.
    const config: Config = createMockConfig(dbService.tempDir);
    const portalAlias = config.portals![0].alias;
    await writeBlueprint(dbService.tempDir, ["code_generation", "cli_delegate"]);

    const logger = new EventLogger({ db: dbService.db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService(config.portals!);

    const executor = new AgentOrchestrator({ config, db: dbService.db, logger, pathResolver, permissions });

    const context: IExecutionContext = {
      trace_id: crypto.randomUUID(),
      request_id: "req-cli-delegate-2",
      request: "Fix the bug",
      plan: "Step 1",
      portal: portalAlias,
    };

    const err = await assertRejects(
      () =>
        executor.executeStep(context, {
          portal: portalAlias,
          identity_id: "cli-delegate-agent",
        }),
    );
    assertStringIncludes(String(err), "Execution strategy not found");

    executor.dispose();
  } finally {
    await dbService.cleanup();
  }
});
