/**
 * @module MilestoneStreamingE2ETest
 * @path tests/integration/flow_milestone_streaming_e2e_test.ts
 * @description End-to-end test verifying milestone events are persisted to NDJSON journal file
 * when execution.milestone_journal_path is configured (Phase 92, Step 8).
 * @architectural-layer Tests
 * @related-files [packages/core/src/observability/file_append_milestone_emitter.ts, packages/core/src/observability/composite_milestone_emitter.ts]
 */

// NOTE (Phase 169 Step 2): this file verifies the separate `IMilestoneEmitter` NDJSON
// stream (packages/core/src/observability/), keyed on `IExecutionMilestone.milestoneType`
// string literals that happen to match some `DomainEventType` values (e.g.
// "llm.call.started"). It does NOT drive, and is not evidence for,
// `TracedProvider`'s own `DomainEventType` emission via `IEventLogger`/the Activity
// Journal — see packages/ai/tests/traced_provider_test.ts for that coverage.

import { assert, assertExists } from "@std/assert";
import { join } from "@std/path";
import { TestEnvironment } from "./helpers/test_environment.ts";
import type { IExecutionMilestone } from "@exaix/schemas";

Deno.test({
  name: "Milestone Streaming E2E: milestones written to journal file when milestone_journal_path is configured",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const milestoneJournalPath = "milestones.ndjson";

    const env = await TestEnvironment.create({
      configOverrides: {
        execution: {
          summarization_model: undefined,
          milestone_streaming_enabled: true,
          milestone_journal_path: milestoneJournalPath,
          native_tools_enabled: false,
        },
      },
    });

    try {
      const filePath = join(env.tempDir, milestoneJournalPath);

      const requestResult = await env.createRequest(
        "Implement a simple hello world function in TypeScript",
        { agentRole: "senior-coder" },
      );

      const { processor } = env.createRequestProcessor();
      const result = await processor.process(requestResult.filePath);
      assertExists(result, "Request processing should complete");

      const content = await Deno.readTextFile(filePath).catch(() => null);
      assertExists(content, "Milestone journal file should exist");
      assert(content.length > 0, "Milestone journal file should not be empty");

      const lines = content.trim().split("\n").filter((l) => l.length > 0);
      assert(lines.length > 0, "Milestone journal should contain at least one milestone");

      const milestones: IExecutionMilestone[] = lines.map((line) => JSON.parse(line));
      const milestoneTypes = milestones.map((m) => m.milestoneType);

      assert(
        milestoneTypes.some((t) => t === "llm.call.started"),
        "Should contain llm.call.started milestone",
      );
      assert(
        milestoneTypes.some((t) => t === "llm.call.completed"),
        "Should contain llm.call.completed milestone",
      );

      assert(
        milestones.every((m) => m.milestoneId && m.traceId),
        "Each milestone should have milestoneId and traceId",
      );
    } finally {
      await env.cleanup();
    }
  },
});
