/**
 * @module JournalIntegritySchemaUpgradeTest
 * @path tests/scripts/journal_integrity_schema_upgrade_test.ts
 * @description Repairs the activity hash-chain columns on existing databases, idempotently
 *   and without rewriting rows. Also covers the missing-table failure path.
 * @architectural-layer Test
 * @related-files [scripts/setup_db.ts, scripts/migrate_db.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { Database } from "@db/sqlite";
import { join } from "@std/path";
import { initTestDbService } from "@exaix/testing";
import { upgradeActivityChainColumns } from "../../scripts/journal_integrity_schema.ts";

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

const REPO_ROOT: string = Deno.cwd();
const SCRIPT_TIMEOUT_MS: number = 30_000;

async function runDbScript(root: string, script: string): Promise<void> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--config",
      join(REPO_ROOT, "deno.json"),
      "-A",
      join(REPO_ROOT, "scripts", script),
      ...(script === "migrate_db.ts" ? ["up"] : []),
    ],
    cwd: root,
    env: { EXA_MIGRATIONS_DIR: join(REPO_ROOT, "migrations") },
    signal: AbortSignal.timeout(SCRIPT_TIMEOUT_MS),
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
}

for (const script of ["setup_db.ts", "migrate_db.ts"]) {
  Deno.test(`[chain schema upgrade] ${script} repairs the chain columns idempotently`, async () => {
    const { db, tempDir, cleanup } = await initTestDbService();
    try {
      await Deno.mkdir(join(tempDir, "migrations"));
      await Deno.copyFile(join(REPO_ROOT, "migrations", "001_init.sql"), join(tempDir, "migrations", "001_init.sql"));
      await runDbScript(tempDir, script);
      await db.close();

      const before: Database = new Database(join(tempDir, ".exa", "journal.db"));
      for (const column of CHAIN_COLUMNS) before.exec(`ALTER TABLE activity DROP COLUMN ${column}`);
      before.close();

      await runDbScript(tempDir, script);
      await runDbScript(tempDir, script);

      const reopened: Database = new Database(join(tempDir, ".exa", "journal.db"));
      try {
        assertEquals(chainColumns(reopened), ["prev_hash", "row_hash"]);
        const history = reopened.prepare("SELECT version FROM schema_migrations ORDER BY id").all();
        assertEquals(history, [{ version: "001_init.sql" }]);
      } finally {
        reopened.close();
      }
    } finally {
      await cleanup();
    }
  });
}
