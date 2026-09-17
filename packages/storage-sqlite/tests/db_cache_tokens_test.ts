/**
 * @module DatabaseServiceCacheTokensTest
 * @path packages/storage-sqlite/tests/db_cache_tokens_test.ts
 * @description DatabaseService.logActivity() had dedicated prompt_tokens/completion_tokens/
 *   cost_usd columns but no cache_read_tokens/cache_creation_tokens, so cache-token
 *   visibility was payload-only and invisible to every consumer that reads the dedicated
 *   columns (OTel export, direct SQL queries). Verifies the new dedicated columns persist
 *   and round-trip through every read path.
 */

import { assertEquals } from "@std/assert";
import { initTestDbService } from "@exaix/testing";

Deno.test("[DatabaseService] logActivity persists cache_read_tokens/cache_creation_tokens and returns them via getActivitiesByTraceSafe", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    db.logActivity(
      "system",
      "llm.call.completed",
      "target",
      { model: "claude-sonnet-5" },
      "trace-cache-columns",
      null,
      "senior-coder",
      null,
      8,
      2428,
      0.1366,
      134127,
      19773,
    );
    await db.waitForFlush();

    const rows = await db.getActivitiesByTraceSafe("trace-cache-columns");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].cache_read_tokens, 134127);
    assertEquals(rows[0].cache_creation_tokens, 19773);
  } finally {
    await cleanup();
  }
});

Deno.test("[DatabaseService] logActivity without cache tokens persists them as null/0, not throwing", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    db.logActivity(
      "system",
      "llm.call.completed",
      "target",
      { model: "claude-sonnet-5" },
      "trace-no-cache-columns",
      null,
      "senior-coder",
    );
    await db.waitForFlush();

    const rows = await db.getActivitiesByTraceSafe("trace-no-cache-columns");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].cache_read_tokens ?? 0, 0);
    assertEquals(rows[0].cache_creation_tokens ?? 0, 0);
  } finally {
    await cleanup();
  }
});
