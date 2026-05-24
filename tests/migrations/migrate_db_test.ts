/**
 * @module DatabaseMigrationTest
 * @path tests/migrations/migrate_db_test.ts
 * @description Verifies the database migration engine, ensuring correct delivery and
 * rollback of schema updates for the persistent journal.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";
import { Database } from "@db/sqlite";
import { getRuntimeDir } from "@exaix/testing";
import type { JSONObject } from "@exaix/core/types";

const __dirname = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

// Helper to run migrate_db.ts with given args
async function runMigrate(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const scriptPath = join(REPO_ROOT, "scripts", "migrate_db.ts");
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--config",
      join(REPO_ROOT, "deno.json"),
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      scriptPath,
      ...args,
    ],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const res = await cmd.output();
  return {
    code: res.code,
    stdout: new TextDecoder().decode(res.stdout),
    stderr: new TextDecoder().decode(res.stderr),
  };
}

// Helper to query database using @db/sqlite library
async function queryDb(dbPath: string, sql: string): Promise<string> {
  const db = new Database(dbPath);
  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all() as Array<JSONObject>;
    const results: string[] = [];
    for (const row of rows) {
      const values = Object.values(row).map((v) => String(v ?? ""));
      // For single-column queries, output value directly (matching sqlite3 CLI behavior)
      // For multi-column queries, use pipe separator
      if (values.length === 1) {
        results.push(values[0]);
      } else {
        results.push(values.join("|"));
      }
    }
    return results.join("\n");
  } finally {
    await db.close();
  }
}

// Setup a temporary workspace with migrations
async function setupTestWorkspace(): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-migrate-test-" });

  // Create migrations directory
  await Deno.mkdir(join(tmp, "migrations"), { recursive: true });

  // Copy migrations from repo
  for await (const entry of Deno.readDir(join(REPO_ROOT, "migrations"))) {
    if (entry.isFile && entry.name.endsWith(".sql")) {
      await Deno.copyFile(
        join(REPO_ROOT, "migrations", entry.name),
        join(tmp, "migrations", entry.name),
      );
    }
  }

  return tmp;
}

Deno.test("migrate_db.ts shows usage when no command provided", async () => {
  const tmp = await setupTestWorkspace();
  try {
    const result = await runMigrate(tmp, []);

    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "Usage:");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("migrate_db.ts shows usage for invalid command", async () => {
  const tmp = await setupTestWorkspace();
  try {
    const result = await runMigrate(tmp, ["invalid"]);

    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "Usage:");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("migrate_db.ts up creates database and applies migrations", async () => {
  const tmp = await setupTestWorkspace();
  try {
    const result = await runMigrate(tmp, ["up"]);

    assertEquals(result.code, 0, `migrate up failed: ${result.stderr}`);
    assertStringIncludes(result.stdout, "Applied");
    assertStringIncludes(result.stdout, "All migrations up to date");

    // Verify database was created
    const dbPath = join(getRuntimeDir(tmp), "journal.db");
    assert(await exists(dbPath), "journal.db should be created");

    // Verify schema_migrations table has entries
    const migrations = await queryDb(
      dbPath,
      "SELECT version FROM schema_migrations;",
    );
    assertStringIncludes(migrations, "001_init.sql");

    // Verify activity table was created (from 001_init.sql)
    const tables = await queryDb(
      dbPath,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
    );
    assertStringIncludes(tables, "activity");
    assertStringIncludes(tables, "leases");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("migrate_db.ts up is idempotent", async () => {
  const tmp = await setupTestWorkspace();
  try {
    // Run up twice
    const result1 = await runMigrate(tmp, ["up"]);
    assertEquals(result1.code, 0, `First migrate up failed: ${result1.stderr}`);

    const result2 = await runMigrate(tmp, ["up"]);
    assertEquals(result2.code, 0, `Second migrate up failed: ${result2.stderr}`);
    assertStringIncludes(result2.stdout, "All migrations up to date");

    // Should not have duplicate migrations
    const dbPath = join(getRuntimeDir(tmp), "journal.db");
    const count = await queryDb(
      dbPath,
      "SELECT COUNT(*) FROM schema_migrations;",
    );
    assertEquals(count.trim(), "1", "Should have exactly 1 migration applied");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("migrate_db.ts down reverts last migration", async () => {
  const tmp = await setupTestWorkspace();
  try {
    // First apply migrations
    const upResult = await runMigrate(tmp, ["up"]);
    assertEquals(upResult.code, 0, `migrate up failed: ${upResult.stderr}`);

    // Then revert
    const downResult = await runMigrate(tmp, ["down"]);
    assertEquals(downResult.code, 0, `migrate down failed: ${downResult.stderr}`);
    assertStringIncludes(downResult.stdout, "Reverted");

    // Verify migration was removed from tracking table
    const dbPath = join(getRuntimeDir(tmp), "journal.db");
    const count = await queryDb(
      dbPath,
      "SELECT COUNT(*) FROM schema_migrations;",
    );
    assertEquals(count.trim(), "0", "Should have 0 migrations after reverting last one");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("migrate_db.ts down with no migrations shows message", async () => {
  const tmp = await setupTestWorkspace();
  try {
    // Create empty System directory with empty database
    await Deno.mkdir(join(tmp, "System"), { recursive: true });

    // Run down without any applied migrations
    const result = await runMigrate(tmp, ["down"]);

    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "No migrations to revert");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("migrate_db.ts creates System directory if missing", async () => {
  const tmp = await setupTestWorkspace();
  try {
    // Ensure System doesn't exist
    const exaDir = join(tmp, ".exa");
    if (await exists(exaDir)) {
      await Deno.remove(exaDir, { recursive: true });
    }

    const result = await runMigrate(tmp, ["up"]);

    assertEquals(result.code, 0, `migrate up failed: ${result.stderr}`);
    assert(await exists(exaDir), ".exa directory should be created");
    assert(
      await exists(join(exaDir, "journal.db")),
      "journal.db should be created",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("migrate_db.ts applies migrations in order", async () => {
  const tmp = await setupTestWorkspace();
  try {
    // Create additional test migration
    const testMigration = `-- up
CREATE TABLE test_order_table (id INTEGER PRIMARY KEY);

-- down
DROP TABLE IF EXISTS test_order_table;
`;
    await Deno.writeTextFile(
      join(tmp, "migrations", "999_test_order.sql"),
      testMigration,
    );

    const result = await runMigrate(tmp, ["up"]);

    assertEquals(result.code, 0, `migrate up failed: ${result.stderr}`);

    // Verify all migrations were applied in order
    const dbPath = join(getRuntimeDir(tmp), "journal.db");
    const migrations = await queryDb(
      dbPath,
      "SELECT version FROM schema_migrations ORDER BY id;",
    );
    const versions = migrations.trim().split("\n");
    assertEquals(versions.length, 2);
    assertEquals(versions[0], "001_init.sql");
    assertEquals(versions[1], "999_test_order.sql");

    // Verify test table was created
    const tables = await queryDb(
      dbPath,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='test_order_table';",
    );
    assertStringIncludes(tables, "test_order_table");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("migrate_db.ts handles invalid SQL gracefully", async () => {
  const tmp = await setupTestWorkspace();
  try {
    // Create migration with invalid SQL
    const badMigration = `-- up
CREATE TABLE good_table (id INTEGER PRIMARY KEY);
INVALID SQL SYNTAX HERE;

-- down
DROP TABLE IF EXISTS good_table;
`;
    await Deno.writeTextFile(
      join(tmp, "migrations", "999_bad_sql.sql"),
      badMigration,
    );

    // First migration should succeed
    // Second should fail and rollback
    const result = await runMigrate(tmp, ["up"]);

    // Should have failed on bad SQL
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "Failed to apply");

    // Verify first migration was applied
    const dbPath = join(getRuntimeDir(tmp), "journal.db");
    const count = await queryDb(
      dbPath,
      "SELECT COUNT(*) FROM schema_migrations;",
    );
    assertEquals(count.trim(), "1", "Baseline migrations should remain applied after rollback");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});
