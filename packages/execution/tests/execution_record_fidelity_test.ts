/**
 * @module ExecutionRecordFidelityTest
 * @path packages/execution/tests/execution_record_fidelity_test.ts
 * @description GAP-9 regression: `generateMissionReport` carries the real completion
 *   content (from the structured plan's executor report) into the execution record's
 *   `summary` and `lessons_learned`, replacing the hardcoded placeholder strings.
 */

import { assertEquals, assertExists } from "@std/assert";

import { ExecutionLoop } from "@exaix/execution";
import { MemoryBankService } from "@exaix/memory";
import { initTestDbService } from "@exaix/testing";

Deno.test("generateMissionReport uses real completion content, not placeholders (GAP-9)", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();

    const loop = new ExecutionLoop({
      config,
      agentRole: "gap9-test",
      memoryBank: bank,
    });

    const traceId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const realContent =
      "Executed the plan: validated portal mount paths before file writes, fixed the rate-limiter reset bug.";

    // Generate the mission report with real completion content (what the success site
    // passes after threading workResult.completionSummary).
    const reportGen = loop["generateMissionReport"].bind(loop) as (
      traceId: string,
      requestId: string,
      frontmatter?: object,
      completionSummary?: string,
    ) => Promise<void>;
    await reportGen(traceId, requestId, undefined, realContent);

    // The execution record must carry the real content, not the placeholder.
    const record = await bank.getExecutionByTraceId(traceId);
    assertExists(record, "the execution record must be created");
    assertEquals(
      record.summary.includes("Successfully executed plan for request:"),
      false,
      "the record summary must not be the placeholder string",
    );
    assertEquals(
      record.summary.includes("validated portal mount paths"),
      true,
      "the record summary must contain the real completion content",
    );
    assertEquals(record.lessons_learned?.length ?? 0, 0, "no regex-mined placeholder lessons");
  } finally {
    await cleanup();
  }
});

Deno.test("generateMissionReport without completion content uses the documented fallback (not real content)", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.initGlobalMemory();

    const loop = new ExecutionLoop({
      config,
      agentRole: "gap9-test",
      memoryBank: bank,
    });

    const traceId = crypto.randomUUID();
    const fallbackGen = loop["generateMissionReport"].bind(loop) as (
      traceId: string,
      requestId: string,
    ) => Promise<void>;
    await fallbackGen(traceId, crypto.randomUUID());

    const record = await bank.getExecutionByTraceId(traceId);
    assertExists(record);
    assertEquals(
      record.summary.includes("Successfully executed plan for request:"),
      true,
      "without completion content the documented fallback applies",
    );
  } finally {
    await cleanup();
  }
});
