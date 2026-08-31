/**
 * @module ConfigDbTest
 * @path packages/core/tests/config/db_test.ts
 * @description Tests for Config DB schema creation, seed migration, and
 *   query functions (getEffectiveValue, getAllEffectiveValues, insertOverride,
 *   getOverrideHistory).
 */
import { Database } from "@db/sqlite";
import { assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { configurable } from "../../src/config/registry.ts";
import { ConfigValueType } from "../../src/types/enums.ts";

// Import source (will fail until db.ts exists)
import {
  addBlocklistPattern,
  compactOverrides,
  countRecentCliWrites,
  ensureConfigDb,
  getAllEffectiveValues,
  getEffectiveValue,
  getOverrideById,
  getOverrideHistory,
  insertOverride,
  isKeyLocked,
  isPathBlocked,
  listBlocklistPatterns,
  listLockedKeys,
  lockKey,
  migrateConfigDb,
  removeBlocklistPattern,
  seedConfigDb,
  unlockKey,
} from "../../src/config/db.ts";

function createTestDb(): { db: Database; dbPath: string; dir: string } {
  const dir = Deno.makeTempDirSync({ prefix: "config-db-test-" });
  const dbPath = join(dir, "config.db");
  const db = new Database(dbPath);
  return { db, dbPath, dir };
}

function cleanUp(dir: string, db: Database): void {
  db.close();
  Deno.removeSync(dir, { recursive: true });
}

Deno.test("[configuring] ensureConfigDb creates .exa directory", () => {
  const dir = Deno.makeTempDirSync({ prefix: "config-db-test-" });
  try {
    const resultPath = ensureConfigDb(dir);
    const expectedDir = join(dir, ".exa");
    const expectedFile = join(expectedDir, "config.db");
    // ensureConfigDb returns the db path
    assertEquals(resultPath, expectedFile);
    // Directory exists
    const dirInfo = Deno.statSync(expectedDir);
    assertNotEquals(dirInfo, null);
    assertNotEquals(dirInfo.isDirectory, false);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[configuring] migrateConfigDb creates config_overrides table", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    const rows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='config_overrides'",
    ).all<{ name: string }>();
    assertEquals(rows.length, 1);
    assertEquals(rows[0].name, "config_overrides");

    // Verify schema columns using PRAGMA table_info
    const columns = db.prepare("PRAGMA table_info(config_overrides)").all<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>();
    const columnNames = columns.map((c) => c.name);
    assertEquals(columnNames.includes("id"), true);
    assertEquals(columnNames.includes("key"), true);
    assertEquals(columnNames.includes("value"), true);
    assertEquals(columnNames.includes("source"), true);
    assertEquals(columnNames.includes("swap_class"), true);
    assertEquals(columnNames.includes("created_at"), true);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] seedConfigDb inserts one row per registry key", () => {
  const { db, dir } = createTestDb();
  try {
    // Register a few test keys
    configurable({
      key: "db_test.seed.key1",
      default: "val1",
      type: ConfigValueType.STRING,
      description: "seed test 1",
    });
    configurable({
      key: "db_test.seed.key2",
      default: 42,
      type: ConfigValueType.NUMBER,
      description: "seed test 2",
    });

    migrateConfigDb(db);
    seedConfigDb(db);

    const count = db.prepare(
      "SELECT COUNT(*) as cnt FROM config_overrides WHERE source='init' AND value IS NULL",
    ).get<{ cnt: number }>();
    // At least 2 seeded keys from this test, plus any from earlier tests
    assertEquals((count?.cnt ?? 0) >= 2, true);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] seedConfigDb is idempotent", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    seedConfigDb(db);
    const count1 = db.prepare("SELECT COUNT(*) as cnt FROM config_overrides").get<{ cnt: number }>();

    seedConfigDb(db);
    const count2 = db.prepare("SELECT COUNT(*) as cnt FROM config_overrides").get<{ cnt: number }>();

    assertEquals(count1?.cnt, count2?.cnt);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] getEffectiveValue returns NULL for unset key", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    // Seed with a test key
    db.prepare(
      "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, NULL, 'init', 'hot')",
    ).run("db_test.null_check");

    const result = getEffectiveValue(db, "db_test.null_check");
    assertEquals(result, null);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] insertOverride appends a row", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);

    insertOverride(db, "db_test.append_check", "first", "cli", "hot");
    const row1 = db.prepare(
      "SELECT id, value FROM config_overrides WHERE key=? ORDER BY id DESC LIMIT 1",
    ).get<{ id: number; value: string }>("db_test.append_check");
    assertEquals(row1?.value, "first");

    insertOverride(db, "db_test.append_check", "second", "cli", "hot");
    const row2 = db.prepare(
      "SELECT id, value FROM config_overrides WHERE key=? ORDER BY id DESC LIMIT 1",
    ).get<{ id: number; value: string }>("db_test.append_check");
    assertEquals(row2?.value, "second");
    // id must be higher (append, not update)
    assertEquals((row2?.id ?? 0) > (row1?.id ?? 0), true);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] getEffectiveValue returns latest non-NULL", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);

    // Insert an init row (NULL), then an override, then another override
    db.prepare(
      "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, NULL, 'init', 'hot')",
    ).run("db_test.override_check");
    db.prepare(
      "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, 'first_val', 'cli', 'hot')",
    ).run("db_test.override_check");
    db.prepare(
      "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, 'second_val', 'cli', 'hot')",
    ).run("db_test.override_check");

    const result = getEffectiveValue(db, "db_test.override_check");
    assertEquals(result, "second_val");
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] getAllEffectiveValues returns all keys with latest values", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);

    db.prepare(
      "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, 'a1', 'cli', 'hot')",
    ).run("db_test.all.key_a");
    db.prepare(
      "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, 'b1', 'cli', 'hot')",
    ).run("db_test.all.key_b");
    db.prepare(
      "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, 'a2', 'cli', 'hot')",
    ).run("db_test.all.key_a");

    const result = getAllEffectiveValues(db);
    assertEquals(result.get("db_test.all.key_a"), "a2");
    assertEquals(result.get("db_test.all.key_b"), "b1");
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] getOverrideHistory returns ordered history", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);

    db.prepare(
      "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, 'v1', 'cli', 'hot')",
    ).run("db_test.history");
    db.prepare(
      "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, 'v2', 'cli', 'hot')",
    ).run("db_test.history");

    const history = getOverrideHistory(db, "db_test.history");
    assertEquals(history.length, 2);
    // Should be DESC order (newest first)
    assertEquals(history[0].value, "v2");
    assertEquals(history[1].value, "v1");
    assertEquals(history[0].source, "cli");
    assertEquals(history[0].swap_class, "hot");
    assertNotEquals(history[0].created_at, undefined);
  } finally {
    cleanUp(dir, db);
  }
});

// config_mcp_blocklist DAO

Deno.test("[configuring] addBlocklistPattern inserts row", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    addBlocklistPattern(db, "system.*", "admin lock");
    const rows = listBlocklistPatterns(db);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].key_pattern, "system.*");
    assertEquals(rows[0].reason, "admin lock");
    assertEquals(rows[0].agent_id, null);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] addBlocklistPattern with agentId inserts agent-scoped row", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    addBlocklistPattern(db, "ai.provider", "no provider swap", "agent-x");
    const rows = listBlocklistPatterns(db);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].agent_id, "agent-x");
    assertEquals(rows[0].key_pattern, "ai.provider");
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] removeBlocklistPattern deletes row", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    addBlocklistPattern(db, "system.*");
    assertEquals(listBlocklistPatterns(db).length, 1);
    removeBlocklistPattern(db, "system.*");
    assertEquals(listBlocklistPatterns(db).length, 0);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] isPathBlocked matches exact key", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    addBlocklistPattern(db, "system.root");
    assertEquals(isPathBlocked(db, "system.root"), true);
    assertEquals(isPathBlocked(db, "system.roots"), false);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] isPathBlocked matches glob prefix", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    addBlocklistPattern(db, "system.*");
    assertEquals(isPathBlocked(db, "system.root"), true);
    assertEquals(isPathBlocked(db, "system.active_profile"), true);
    assertEquals(isPathBlocked(db, "ai.timeout_ms"), false);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] isPathBlocked matches glob suffix", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    addBlocklistPattern(db, "*.api_key");
    assertEquals(isPathBlocked(db, "providers.openai.api_key"), true);
    assertEquals(isPathBlocked(db, "ai.timeout_ms"), false);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] isPathBlocked returns false for non-matching key", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    addBlocklistPattern(db, "system.*");
    assertEquals(isPathBlocked(db, "ai.provider"), false);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] isPathBlocked respects agent scope", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    // Agent-scoped block: only blocks agent-x.
    addBlocklistPattern(db, "ai.provider", undefined, "agent-x");
    assertEquals(isPathBlocked(db, "ai.provider", "agent-x"), true);
    assertEquals(isPathBlocked(db, "ai.provider", "agent-y"), false);
    assertEquals(isPathBlocked(db, "ai.provider"), false);
    // NULL-agent block: blocks everyone.
    addBlocklistPattern(db, "system.root");
    assertEquals(isPathBlocked(db, "system.root", "agent-y"), true);
    assertEquals(isPathBlocked(db, "system.root"), true);
  } finally {
    cleanUp(dir, db);
  }
});

// rate limiting (countRecentCliWrites, hard limit, compact)

import { ConfigRateLimitedError } from "../../src/config/errors.ts";
import type { IEventLogger } from "../../src/logger/event_logger.ts";

/** Insert `n` config_overrides rows (small counts; used to cross an injected test threshold). */
function seedRows(db: Database, n: number, source = "cli"): void {
  const stmt = db.prepare(
    "INSERT INTO config_overrides (key, value, source, swap_class) VALUES ('bulk.key', 'v', ?, 'hot')",
  );
  for (let i = 0; i < n; i++) stmt.run(source);
}

Deno.test("[configuring] countRecentCliWrites counts only in-window cli rows", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    insertOverride(db, "rl.a", "1", "cli", "hot");
    insertOverride(db, "rl.b", "2", "cli", "hot");
    insertOverride(db, "rl.c", "3", "init", "hot"); // not cli — excluded
    const count = countRecentCliWrites(db, 5_000);
    assertEquals(count, 2);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] countRecentCliWrites excludes rows older than the window", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    // An old cli row (created_at well in the past).
    db.prepare(
      "INSERT INTO config_overrides (key, value, source, swap_class, created_at) VALUES ('rl.old', 'x', 'cli', 'hot', datetime('now','-1 hour'))",
    ).run();
    insertOverride(db, "rl.new", "y", "cli", "hot");
    assertEquals(countRecentCliWrites(db, 5_000), 1);
  } finally {
    cleanUp(dir, db);
  }
});

// The DB hard-limit is an anti-DoS guard against a runaway/malicious agent flooding the
// append-only log — no legitimate use approaches it (~10 writes/month). These [security]
// tests exercise the rejection branch at a tiny injected threshold; production uses the real 1M/100K constants.
const TEST_HARD_LIMIT = 3;
const TEST_WARN_THRESHOLD = 2;

Deno.test("[configuring][security] insertOverride rejects a normal cli write at the hard limit", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    seedRows(db, TEST_HARD_LIMIT, "cli");
    let threw = false;
    try {
      insertOverride(db, "rl.blocked", "v", "cli", "hot", { hardLimit: TEST_HARD_LIMIT });
    } catch (e) {
      threw = e instanceof ConfigRateLimitedError;
    }
    assertEquals(threw, true, "cli write at hard limit must throw ConfigRateLimitedError");
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring][security] insertOverride exempts tombstone and init writes at the hard limit", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    seedRows(db, TEST_HARD_LIMIT, "cli");
    // Tombstone (value === null) write — must succeed even at the hard limit.
    insertOverride(db, "rl.unset", null, "cli", "hot", { hardLimit: TEST_HARD_LIMIT });
    // init write — must succeed.
    insertOverride(db, "rl.seed", "v", "init", "hot", { hardLimit: TEST_HARD_LIMIT });
    // A normal cli write is still blocked (proves the exemption is targeted).
    let threw = false;
    try {
      insertOverride(db, "rl.norm", "v", "cli", "hot", { hardLimit: TEST_HARD_LIMIT });
    } catch (e) {
      threw = e instanceof ConfigRateLimitedError;
    }
    assertEquals(threw, true);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] insertOverride warns at the threshold via injected logger", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    seedRows(db, TEST_WARN_THRESHOLD, "cli");
    let warned = false;
    const noop = (): Promise<void> => Promise.resolve();
    const logger: IEventLogger = {
      log: noop,
      info: noop,
      warn: () => {
        warned = true;
        return Promise.resolve();
      },
      error: noop,
      fatal: noop,
      debug: noop,
      child: () => logger,
    };
    insertOverride(db, "rl.warn", "v", "cli", "hot", {
      logger,
      hardLimit: 1000,
      warnThreshold: TEST_WARN_THRESHOLD,
    });
    assertEquals(warned, true, "insertOverride must warn once at/over the threshold");
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] compactOverrides collapses to one row per key preserving values", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    insertOverride(db, "c.a", "a1", "cli", "hot");
    insertOverride(db, "c.a", "a2", "cli", "hot");
    insertOverride(db, "c.a", "a3", "cli", "hot");
    insertOverride(db, "c.b", "b1", "cli", "hot");

    const removed = compactOverrides(db);
    assertEquals(removed, 2, "two superseded c.a rows removed");

    // One row per key, latest values preserved.
    assertEquals(getEffectiveValue(db, "c.a"), "a3");
    assertEquals(getEffectiveValue(db, "c.b"), "b1");
    const total = db.prepare("SELECT COUNT(*) AS cnt FROM config_overrides").get<{ cnt: number }>();
    assertEquals(total?.cnt, 2);
  } finally {
    cleanUp(dir, db);
  }
});

// getOverrideById point lookup

Deno.test("[configuring] getOverrideById returns the matching row / undefined", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    insertOverride(db, "r.key", "v1", "cli", "hot");
    insertOverride(db, "r.key", "v2", "cli", "hot");
    const history = getOverrideHistory(db, "r.key");
    const first = history.find((h) => h.value === "v1")!;
    const found = getOverrideById(db, "r.key", first.id);
    assertEquals(found?.value, "v1");
    assertEquals(found?.id, first.id);
    // Wrong key for a real id → undefined; unknown id → undefined.
    assertEquals(getOverrideById(db, "other.key", first.id), undefined);
    assertEquals(getOverrideById(db, "r.key", 999999), undefined);
  } finally {
    cleanUp(dir, db);
  }
});

// config_locked_keys DAO

Deno.test("[configuring] lockKey/unlockKey/isKeyLocked/listLockedKeys DAO round-trip", () => {
  const { db, dir } = createTestDb();
  try {
    migrateConfigDb(db);
    assertEquals(isKeyLocked(db, "system.root"), false);

    lockKey(db, "system.root", "cli", "compromised");
    assertEquals(isKeyLocked(db, "system.root"), true);
    // Idempotent on the `key` PRIMARY KEY — a re-lock updates the row in place
    // (one row, latest reason wins) rather than inserting a duplicate.
    lockKey(db, "system.root", "cli", "again");
    const locks = listLockedKeys(db);
    assertEquals(locks.length, 1);
    assertEquals(locks[0].key, "system.root");
    assertEquals(locks[0].locked_by, "cli");
    assertEquals(locks[0].reason, "again");

    unlockKey(db, "system.root");
    assertEquals(isKeyLocked(db, "system.root"), false);
    assertEquals(listLockedKeys(db).length, 0);
  } finally {
    cleanUp(dir, db);
  }
});
