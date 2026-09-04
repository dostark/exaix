/**
 * @module AgentComposerStepDurationTest
 * @path packages/execution/tests/agent_orchestrator_step_duration_test.ts
 * @related-files [packages/execution/src/agent_composer.ts]
 * @architectural-layer Services
 * @description Phase 140a Step 2 — RED-first test. AgentComposer.executeStep computes
 * a real wall-clock _startTime but never wires it into a per-step duration on
 * agent.execution_completed's journal payload — the field is currently dead
 * (underscore-prefixed, unused). Verifies logExecutionComplete accepts and journals a
 * duration_ms distinct from the strategy-internal execution_time_ms already on the
 * IChangesetResult itself.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { AgentComposer } from "@exaix/execution";
import { initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { createTestConfig } from "../../ai/tests/helpers/test_config.ts";
import type { IDatabaseService } from "@exaix/core/types";
import type { Config } from "@exaix/schemas/config.ts";

const testConfig: Config = createTestConfig();

async function setupExecutor(): Promise<{
  executor: AgentComposer;
  db: IDatabaseService;
  cleanup: () => Promise<void>;
}> {
  const { db, cleanup } = await initTestDbService();
  const logger = new EventLogger({ db });
  const pathResolver = new PathResolver(testConfig);
  const permissions = new PortalPermissionsService([]);
  const executor = new AgentComposer({ config: testConfig, db, logger, pathResolver, permissions });
  return { executor, db, cleanup };
}

Deno.test({
  name: "[AgentComposerStepDuration] logExecutionComplete journals a real duration_ms distinct from execution_time_ms",
  fn: async () => {
    const { executor, db, cleanup } = await setupExecutor();
    try {
      const trace_id = crypto.randomUUID();
      await executor.logExecutionComplete(
        trace_id,
        "test-agent",
        {
          branch: "feat/test",
          commit_sha: "abc1234",
          files_changed: ["file.txt"],
          description: "Test changes",
          tool_calls: 5,
          execution_time_ms: 1000,
        },
        undefined,
        250,
      );

      await db.waitForFlush();
      const activities = db.getActivitiesByTrace(trace_id);
      const completeActivity = activities.find((a) => a.action_type === "agent.execution_completed");
      assertExists(completeActivity);

      const payload = JSON.parse(completeActivity.payload ?? "{}") as {
        duration_ms?: number;
        execution_time_ms?: number;
      };
      assertEquals(payload.duration_ms, 250);
      assertEquals(payload.execution_time_ms, 1000);
      assert(
        payload.duration_ms !== payload.execution_time_ms,
        "duration_ms must be distinct from the strategy's own execution_time_ms",
      );
    } finally {
      await cleanup();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
