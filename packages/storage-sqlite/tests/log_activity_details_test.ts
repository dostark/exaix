/**
 * @module DatabaseServiceLogActivityDetailsTest
 * @path packages/storage-sqlite/tests/log_activity_details_test.ts
 * @description Proves that logActivity writes the same journal row from the named details object as it wrote from the old positional tail, and that the logging test double records the same call the same way.
 * @architectural-layer Testing
 * @related-files [packages/storage-sqlite/src/database_service.ts, packages/testing/src/helpers/db.ts, packages/core/src/types/i_database_service.ts]
 */

import { assertEquals } from "@std/assert";
import { createLoggingTestDb, initTestDbService } from "@exaix/testing";

const TRACE = "trace-details";
const DETAILS = {
  actorType: "agent",
  agentRole: "senior-coder",
  runnerKind: "claude-cli",
  promptTokens: 8,
  completionTokens: 2428,
  costUsd: 0.1366,
  cacheReadTokens: 134127,
  cacheCreationTokens: 19773,
};

Deno.test("logactivity-journal-fields-preserved: a call with each detail field writes every dedicated column", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    db.logActivity("system", "llm.call.completed", "target", { model: "m" }, TRACE, DETAILS);
    await db.waitForFlush();
    const rows = await db.getActivitiesByTraceSafe(TRACE);
    assertEquals(rows.length, 1);
    const row = rows[0];
    assertEquals(
      [row.actor_type, row.agent_role, row.runner_kind, row.prompt_tokens, row.completion_tokens, row.cost_usd],
      ["agent", "senior-coder", "claude-cli", 8, 2428, 0.1366],
    );
    assertEquals([row.cache_read_tokens, row.cache_creation_tokens], [134127, 19773]);
  } finally {
    await cleanup();
  }
});

Deno.test("logactivity-journal-fields-preserved: a call without details writes the defaults of a bare call", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    db.logActivity("system", "request.created", "target", {}, TRACE);
    await db.waitForFlush();
    const row = (await db.getActivitiesByTraceSafe(TRACE))[0];
    assertEquals([row.actor_type, row.agent_role, row.runner_kind], [null, null, null]);
    assertEquals([row.prompt_tokens, row.completion_tokens, row.cost_usd], [0, 0, 0]);
    assertEquals([row.cache_read_tokens ?? 0, row.cache_creation_tokens ?? 0], [0, 0]);
  } finally {
    await cleanup();
  }
});

Deno.test("logactivity-journal-fields-preserved: an explicit null cost stays null and a partial details object fills the rest", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    db.logActivity("system", "llm.call.completed", "target", {}, TRACE, { agentRole: "qa", costUsd: null });
    await db.waitForFlush();
    const row = (await db.getActivitiesByTraceSafe(TRACE))[0];
    assertEquals([row.agent_role, row.actor_type, row.cost_usd, row.prompt_tokens], ["qa", null, null, 0]);
  } finally {
    await cleanup();
  }
});

Deno.test("logactivity-implementers-aligned: the logging test double records the detail fields of the same call", () => {
  const { activities, db } = createLoggingTestDb();
  db.logActivity("system", "llm.call.completed", "target", { model: "m" }, TRACE, DETAILS);
  const [entry] = activities;
  assertEquals(entry.traceId, TRACE);
  assertEquals(
    [entry.actorType, entry.agentRole, entry.runnerKind, entry.promptTokens, entry.completionTokens, entry.costUsd],
    ["agent", "senior-coder", "claude-cli", 8, 2428, 0.1366],
  );
});
