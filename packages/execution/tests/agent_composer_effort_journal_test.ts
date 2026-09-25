/**
 * @module AgentComposerEffortJournalTest
 * @path packages/execution/tests/agent_composer_effort_journal_test.ts
 * @description Phase-197 Step 6: AgentComposer.executeStep emits agent.effort_resolved with
 *   path "execution" on the SAME traceId as the plan that produced the request declaration.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_composer.ts, packages/core/src/events/domain_event_types.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { AgentComposer, StrategyRegistry } from "@exaix/execution";
import { ExecutionStrategyName, SecurityMode } from "@exaix/core";
import { createTestConfig } from "../../../packages/ai/tests/helpers/test_config.ts";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";

async function setup(): Promise<{
  testDir: string;
  cleanup: () => Promise<void>;
}> {
  const testDir = await Deno.makeTempDir({ prefix: "ac-effort-journal-" });
  await Deno.mkdir(join(testDir, "Blueprints", "Agents"), { recursive: true });
  await Deno.writeTextFile(
    join(testDir, "Blueprints", "Agents", "test-agent.md"),
    "---\nagent_role: test-agent\nname: Test\nmodel: mock:test\neffort: low\n---\nYou are a test agent.\n",
  );
  return { testDir, cleanup: () => Deno.remove(testDir, { recursive: true }).catch(() => {}) };
}

Deno.test("AgentComposer.executeStep emits agent.effort_resolved with path execution and the plan traceId", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const { testDir, cleanup: dirCleanup } = await setup();
    try {
      const config = createTestConfig();
      config.system.root = testDir;
      config.portals = [{ alias: "TestPortal", target_path: testDir, operations: [] }] as never;

      const strategyRegistry = new StrategyRegistry();
      strategyRegistry.register({
        name: ExecutionStrategyName.LEGACY,
        execute: (_bp: object, _ctx: object, _opts: object) =>
          Promise.resolve({
            branch: "feat/effort",
            commit_sha: "0000000000000000000000000000000000000000",
            files_changed: [],
            description: "Done",
            tool_calls: 0,
            execution_time_ms: 1,
          } as IChangesetResult),
      } as never);

      const logger = new EventLogger({ db });
      const pathResolver = new PathResolver(config);
      const permissions = new PortalPermissionsService(config.portals as never);
      const composer = new AgentComposer({
        config,
        db,
        logger,
        pathResolver,
        permissions,
        strategyRegistry,
        options: { requestDeclaration: { effort: "high" } },
      });

      const planTraceId = crypto.randomUUID();
      const context: IExecutionContext = {
        trace_id: planTraceId,
        request_id: "effort-journal-req",
        request: "Implement the feature",
        plan: "Implement the feature",
        portal: "TestPortal",
      } as never;
      const options: IAgentExecutionOptions = {
        portal: "TestPortal",
        agent_role: "test-agent",
        security_mode: SecurityMode.HYBRID,
        timeout_ms: 30000,
        max_tool_calls: 5,
        audit_enabled: true,
      } as IAgentExecutionOptions;

      await composer.executeStep(context, options);
      composer.dispose();
      await db.waitForFlush();

      const rows = await db.queryActivity({ traceId: planTraceId, actionType: "agent.effort_resolved" });
      assertEquals(rows.length, 1);
      const payload = JSON.parse(rows[0].payload) as { path: string; effort?: string; effort_basis: string };
      assertEquals(payload.path, "execution");
      assertEquals(payload.effort, "high");
      assertEquals(payload.effort_basis, "declared");
    } finally {
      await dirCleanup();
    }
  } finally {
    await cleanup();
  }
});
