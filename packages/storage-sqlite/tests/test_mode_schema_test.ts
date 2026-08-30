/**
 * @module DatabaseServiceTestModeSchemaTest
 * @path packages/storage-sqlite/tests/test_mode_schema_test.ts
 * @description Phase 127 Step 8 — RED-first test: in test mode (EXA_TEST_MODE=1) a freshly
 *   constructed DatabaseService must already have the production-shaped `activity` table, with no
 *   manual initActivityTableSchema / migration call. In production the table is created by
 *   migrations (setup_db) before the daemon starts; test-mode DBs had no such step, so every
 *   integration test had to pre-seed the schema and a test-mode daemon booting on a fresh journal
 *   found `no such table: activity`. The constructor now ensures the schema in test mode only.
 * @architectural-layer Test
 * @related-files [packages/storage-sqlite/src/database_service.ts, packages/storage-sqlite/src/connection_pool.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DatabaseService } from "../src/database_service.ts";
import { ConfigService } from "@exaix/core/config";
import { withEnv } from "@exaix/testing";

function writeMinimalConfig(configPath: string, root: string): void {
  Deno.writeTextFileSync(
    configPath,
    [
      "[system]",
      `root = "${root}"`,
      'log_level = "info"',
      "[paths]",
      'runtime = "./.exa"',
      'workspace = "./Workspace"',
      "[database]",
      "batch_flush_ms = 50",
      "batch_max_size = 100",
      "[database.sqlite]",
      'journal_mode = "WAL"',
      "foreign_keys = true",
      "busy_timeout_ms = 5000",
    ].join("\n"),
  );
}

Deno.test("[test_mode_schema] a DatabaseService built in test mode has the activity table without manual init", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "test-mode-schema-" });
  const configPath = join(tempDir, "exa.config.toml");
  writeMinimalConfig(configPath, tempDir);
  try {
    await withEnv({ EXA_TEST_MODE: "1" }, async () => {
      const config = new ConfigService(configPath).getAll();
      const db = new DatabaseService(config);
      try {
        // Logging + reading must work end-to-end with NO initActivityTableSchema call.
        await db.logActivity("system", "test.event", "target", { ok: true }, "trace-x", null, "id-x");
        await db.waitForFlush();
        const rows = await db.getRecentActivity(10);
        assertEquals(rows.length, 1);
        assertEquals(rows[0].action_type, "test.event");
      } finally {
        await db.close();
      }
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("[test_mode_schema] outside test mode the constructor does NOT auto-create the table (production relies on migrations)", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "prod-mode-schema-" });
  const configPath = join(tempDir, "exa.config.toml");
  writeMinimalConfig(configPath, tempDir);
  try {
    await withEnv({ EXA_TEST_MODE: null, EXA_TEST_CLI_MODE: null }, async () => {
      const config = new ConfigService(configPath).getAll();
      const db = new DatabaseService(config);
      try {
        // No migrations run + not test mode → the activity table must be absent (unchanged prod behavior).
        let threw = false;
        try {
          await db.getRecentActivity(1);
        } catch {
          threw = true;
        }
        assert(threw, "production-mode constructor must not silently create the activity table");
      } finally {
        await db.close();
      }
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("[test_mode_schema] opening a second DatabaseService while the first is open does not throw 'database is locked' (restart-overlap regression)", async () => {
  // Set busy_timeout before WAL mode so overlapping connections wait for transient locks
  // instead of failing immediately.
  const tempDir = await Deno.makeTempDir({ prefix: "db-restart-overlap-" });
  const configPath = join(tempDir, "exa.config.toml");
  writeMinimalConfig(configPath, tempDir);
  try {
    await withEnv({ EXA_TEST_MODE: "1" }, async () => {
      const config = new ConfigService(configPath).getAll();
      const first = new DatabaseService(config);
      try {
        // Hold a write so the first connection has the DB actively locked.
        await first.logActivity("system", "first.open", "t", { a: 1 }, "trace-1", null, "id-1");
        // Second open on the SAME db while the first is live — must not throw "database is locked".
        const second = new DatabaseService(config);
        try {
          await second.logActivity("system", "second.open", "t", { b: 2 }, "trace-2", null, "id-2");
          await second.waitForFlush();
          const rows = await second.getRecentActivity(10);
          assert(rows.length >= 1, "second connection must be usable, not lock-crashed");
        } finally {
          await second.close();
        }
      } finally {
        await first.close();
      }
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
