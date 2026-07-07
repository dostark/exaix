/**
 * @module ConfigDbWatcherTest
 * @path packages/core/tests/config/db_watcher_test.ts
 * @description Tests for Config DB polling watcher — createDbWatcherHandler,
 *   getMaxOverrideId, and hot-apply vs restart-required logic.
 */
import { Database } from "@db/sqlite";
import { assertEquals } from "@std/assert";
import { InMemoryConfigStore } from "../../src/config/store.ts";
import { createDbWatcherHandler } from "../../src/config/db_watcher_handler.ts";
import {
  ensureConfigDb,
  getMaxOverrideId,
  insertOverride,
  migrateConfigDb,
  seedConfigDb,
} from "../../src/config/db.ts";
import { SwapClass } from "../../src/types/enums.ts";
import { configurable } from "../../src/config/registry.ts";
import { ConfigValueType } from "../../src/types/enums.ts";

// Register test keys
configurable({
  key: "db_watcher_test.timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "DB watcher test timeout",
  min: 1000,
  max: 120000,
  swap: SwapClass.HOT,
});
configurable({
  key: "db_watcher_test.model",
  default: "default-model",
  type: ConfigValueType.STRING,
  description: "DB watcher test model",
  swap: SwapClass.RESTART,
});

function setup(): { store: InMemoryConfigStore; db: Database; dir: string } {
  const dir = Deno.makeTempDirSync({ prefix: "db-watcher-test-" });
  const dbPath = ensureConfigDb(dir);
  const db = new Database(dbPath);
  migrateConfigDb(db);
  seedConfigDb(db);

  const store = new InMemoryConfigStore();
  store.set("db_watcher_test.timeout_ms", 30000, SwapClass.HOT);
  store.set("db_watcher_test.model", "default-model", SwapClass.RESTART);
  return { store, db, dir };
}

function cleanUp(dir: string, db: Database): void {
  db.close();
  Deno.removeSync(dir, { recursive: true });
}

Deno.test("[configuring] getMaxOverrideId returns 0 for empty table", () => {
  const dir = Deno.makeTempDirSync({ prefix: "db-watcher-test-" });
  try {
    const dbPath = ensureConfigDb(dir);
    const db = new Database(dbPath);
    try {
      migrateConfigDb(db);
      assertEquals(getMaxOverrideId(db), 0);
    } finally {
      db.close();
    }
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[configuring] getMaxOverrideId returns latest id", () => {
  const dir = Deno.makeTempDirSync({ prefix: "db-watcher-test-" });
  try {
    const dbPath = ensureConfigDb(dir);
    const db = new Database(dbPath);
    try {
      migrateConfigDb(db);
      seedConfigDb(db);
      const id1 = getMaxOverrideId(db);
      insertOverride(db, "test.key", "value1", "test", "hot");
      const id2 = getMaxOverrideId(db);
      assertEquals(id2 > id1, true);
      insertOverride(db, "test.key", "value2", "test", "hot");
      const id3 = getMaxOverrideId(db);
      assertEquals(id3 > id2, true);
    } finally {
      db.close();
    }
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test({
  name: "[configuring] createDbWatcherHandler hot-applies new overrides",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { store, db, dir } = setup();
    try {
      // Insert a new override via DB (simulating external CLI write)
      insertOverride(db, "db_watcher_test.timeout_ms", "45000", "cli", "hot");

      // Run the handler
      await createDbWatcherHandler(store, db)();
      assertEquals(store.get("db_watcher_test.timeout_ms"), "45000");
    } finally {
      cleanUp(dir, db);
    }
  },
});

Deno.test({
  name: "[configuring] createDbWatcherHandler skips restart-required keys",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { store, db, dir } = setup();
    try {
      assertEquals(store.get("db_watcher_test.model"), "default-model");

      // Insert restart override via DB
      insertOverride(db, "db_watcher_test.model", "new-model", "cli", "restart");

      // Run the handler
      await createDbWatcherHandler(store, db)();
      // Store should NOT be updated for restart-required keys
      assertEquals(store.get("db_watcher_test.model"), "default-model");
    } finally {
      cleanUp(dir, db);
    }
  },
});

Deno.test({
  name: "[configuring] createDbWatcherHandler does nothing when no changes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { store, db, dir } = setup();
    try {
      // Run handler without any new overrides
      await createDbWatcherHandler(store, db)();
      assertEquals(store.get("db_watcher_test.timeout_ms"), 30000);
    } finally {
      cleanUp(dir, db);
    }
  },
});
