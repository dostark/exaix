/**
 * @module JournalIntegritySchemaUpgradeTest
 * @path tests/scripts/journal_integrity_schema_upgrade_test.ts
 * @description Repairs the activity hash-chain columns on existing databases, idempotently
 *   and without rewriting rows. Also covers the missing-table failure path.
 * @architectural-layer Test
 * @related-files [scripts/setup_db.ts, scripts/migrate_db.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import type { Database } from "@db/sqlite";
import { join } from "@std/path";
import { initTestDbService } from "@exaix/testing";
import { upgradeActivityChainColumns } from "../../scripts/journal_integrity_schema.ts";
import {
  assertSingleInitMigration,
  openUpgradedJournalDb,
  runSchemaUpgradeDbScript,
  SCHEMA_UPGRADE_REPO_ROOT,
} from "./helpers/schema_upgrade_test_helper.ts";

const CHAIN_COLUMNS: readonly string[] = ["prev_hash", "row_hash"];

function chainColumns(db: Database): string[] {
  const rows = db.prepare(
    "SELECT name FROM pragma_table_info('activity') WHERE name IN ('prev_hash','row_hash') ORDER BY name",
  ).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

Deno.test("[chain schema upgrade] adds missing columns idempotently", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    db.instance.exec("ALTER TABLE activity DROP COLUMN prev_hash");
    db.instance.exec("ALTER TABLE activity DROP COLUMN row_hash");
    assertEquals(chainColumns(db.instance), []);

    upgradeActivityChainColumns(db.instance);
    upgradeActivityChainColumns(db.instance);
    assertEquals(chainColumns(db.instance), ["prev_hash", "row_hash"]);
    assertEquals(db.instance.prepare("SELECT prev_hash, row_hash FROM activity").all(), []);
  } finally {
    await cleanup();
  }
});

Deno.test("[chain schema upgrade] missing activity table fails without silently creating it", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    db.instance.exec("DROP TABLE activity");
    assertThrows(() => upgradeActivityChainColumns(db.instance), Error, "activity table is missing");
    assertEquals(db.instance.prepare("PRAGMA table_info(activity)").all(), []);
    db.instance.exec("BEGIN; ROLLBACK;");
  } finally {
    await cleanup();
  }
});

for (const script of ["setup_db.ts", "migrate_db.ts"]) {
  Deno.test(`[chain schema upgrade] ${script} repairs the chain columns idempotently`, async () => {
    const { db, tempDir, cleanup } = await initTestDbService();
    try {
      await Deno.mkdir(join(tempDir, "migrations"));
      await Deno.copyFile(
        join(SCHEMA_UPGRADE_REPO_ROOT, "migrations", "001_init.sql"),
        join(tempDir, "migrations", "001_init.sql"),
      );
      await runSchemaUpgradeDbScript(tempDir, script);
      await db.close();

      const before: Database = openUpgradedJournalDb(tempDir);
      for (const column of CHAIN_COLUMNS) before.exec(`ALTER TABLE activity DROP COLUMN ${column}`);
      before.close();

      await runSchemaUpgradeDbScript(tempDir, script);
      await runSchemaUpgradeDbScript(tempDir, script);

      const reopened: Database = openUpgradedJournalDb(tempDir);
      try {
        assertEquals(chainColumns(reopened), ["prev_hash", "row_hash"]);
        assertSingleInitMigration(reopened);
      } finally {
        reopened.close();
      }
    } finally {
      await cleanup();
    }
  });
}
