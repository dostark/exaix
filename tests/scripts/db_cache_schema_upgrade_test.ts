/**
 * @module DbCacheSchemaUpgradeTest
 * @path tests/scripts/db_cache_schema_upgrade_test.ts
 * @description Exercises both database scripts against existing and partially upgraded
 * activity schemas, preserving rows, existing cache values and migration history.
 * @architectural-layer Test
 * @related-files [scripts/setup_db.ts, scripts/migrate_db.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { stub } from "@std/testing/mock";
import type { Database } from "@db/sqlite";
import { join } from "@std/path";
import { initTestDbService } from "@exaix/testing";
import { DomainEventType } from "@exaix/core/events";
import { upgradeActivityCacheColumns } from "../../scripts/activity_cache_schema.ts";
import {
  assertSingleInitMigration,
  openUpgradedJournalDb,
  runSchemaUpgradeDbScript,
  SCHEMA_UPGRADE_REPO_ROOT,
} from "./helpers/schema_upgrade_test_helper.ts";

interface ICacheRow {
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
}

Deno.test("[cache schema upgrade] failed second column addition rolls back the first and releases the transaction", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    db.instance.exec("ALTER TABLE activity DROP COLUMN cache_read_tokens");
    db.instance.exec("ALTER TABLE activity DROP COLUMN cache_creation_tokens");
    const execute = db.instance.exec.bind(db.instance);
    const ddlStub = stub(db.instance, "exec", (...args: Parameters<Database["exec"]>): number => {
      if (args[0] === "ALTER TABLE activity ADD COLUMN cache_creation_tokens INTEGER") {
        throw new Error("injected DDL failure");
      }
      return execute(args[0]);
    });
    try {
      assertThrows(() => upgradeActivityCacheColumns(db.instance), Error, "injected DDL failure");
    } finally {
      ddlStub.restore();
    }
    const columns = db.instance.prepare("SELECT name FROM pragma_table_info('activity') WHERE name LIKE 'cache_%'")
      .all();
    assertEquals(columns, []);
    upgradeActivityCacheColumns(db.instance);
    assertEquals(db.instance.prepare("SELECT cache_read_tokens, cache_creation_tokens FROM activity").all(), []);
  } finally {
    await cleanup();
  }
});

Deno.test("[cache schema upgrade] missing activity table fails without silently creating it", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    db.instance.exec("DROP TABLE activity");
    assertThrows(() => upgradeActivityCacheColumns(db.instance), Error, "activity table is missing");
    assertEquals(db.instance.prepare("PRAGMA table_info(activity)").all(), []);
    db.instance.exec("BEGIN; ROLLBACK;");
  } finally {
    await cleanup();
  }
});

const CACHE_READ_TOKENS: number = 11136;
const CACHE_CREATION_TOKENS: number = 19773;
const SCHEMA_CASES: readonly (readonly string[])[] = [
  ["cache_read_tokens", "cache_creation_tokens"],
  ["cache_read_tokens"],
  ["cache_creation_tokens"],
  [],
];

for (const script of ["setup_db.ts", "migrate_db.ts"]) {
  for (const missingColumns of SCHEMA_CASES) {
    Deno.test(`[cache schema upgrade] ${script} repairs ${missingColumns.join(",") || "no missing columns"} idempotently`, async () => {
      const { db, tempDir, cleanup } = await initTestDbService();
      try {
        await Deno.mkdir(join(tempDir, "migrations"));
        await Deno.copyFile(
          join(SCHEMA_UPGRADE_REPO_ROOT, "migrations", "001_init.sql"),
          join(tempDir, "migrations", "001_init.sql"),
        );
        // Record the consolidated migration through the real script before simulating an older schema.
        await runSchemaUpgradeDbScript(tempDir, script);
        db.logActivity(
          "system",
          DomainEventType.LlmCallCompleted,
          "upgrade-fixture",
          {},
          "cache-upgrade",
          null,
          null,
          null,
          1,
          1,
          0,
          CACHE_READ_TOKENS,
          CACHE_CREATION_TOKENS,
        );
        await db.waitForFlush();
        for (const column of missingColumns) {
          db.instance.exec(`ALTER TABLE activity DROP COLUMN ${column}`);
        }
        await db.close();

        await runSchemaUpgradeDbScript(tempDir, script);
        await runSchemaUpgradeDbScript(tempDir, script);
        const reopened: Database = openUpgradedJournalDb(tempDir);
        try {
          const rows: ICacheRow[] = reopened.prepare(
            "SELECT cache_read_tokens, cache_creation_tokens FROM activity WHERE trace_id = ?",
          ).all("cache-upgrade") as ICacheRow[];
          assertEquals(rows, [{
            cache_read_tokens: missingColumns.includes("cache_read_tokens") ? null : CACHE_READ_TOKENS,
            cache_creation_tokens: missingColumns.includes("cache_creation_tokens") ? null : CACHE_CREATION_TOKENS,
          }]);
          assertSingleInitMigration(reopened);
        } finally {
          reopened.close();
        }
      } finally {
        await cleanup();
      }
    });
  }
}
