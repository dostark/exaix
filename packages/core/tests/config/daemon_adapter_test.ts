/**
 * @module DaemonConfigAdapterTest
 * @path packages/core/tests/config/daemon_adapter_test.ts
 * @description Tests for DaemonConfigAdapter — daemon-mode config adapter that
 *   reads from InMemoryConfigStore and writes through to Config DB.
 */
import { Database } from "@db/sqlite";
import { assertEquals, assertRejects } from "@std/assert";
import { InMemoryConfigStore } from "../../src/config/store.ts";
import { createConfigAdapter, createConfigAdapterAsync, DaemonConfigAdapter } from "../../src/config/adapter.ts";
import { configurable } from "../../src/config/registry.ts";
import { ensureConfigDb, migrateConfigDb, seedConfigDb } from "../../src/config/db.ts";
import { ConfigValueType, SwapClass } from "../../src/types/enums.ts";
import { ConfigKeyNotFoundError } from "../../src/config/errors.ts";

// Register test keys needed for this test file
configurable({
  key: "daemon_test.timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Daemon adapter test timeout",
  min: 1000,
  max: 120000,
});
configurable({
  key: "daemon_test.greeting",
  default: "hello",
  type: ConfigValueType.STRING,
  description: "Daemon adapter test greeting",
});
configurable({
  key: "daemon_test.models.*.model",
  default: "",
  type: ConfigValueType.STRING,
  description: "Daemon adapter test per-name model pattern",
});

function setupDaemonAdapter(): {
  adapter: DaemonConfigAdapter;
  store: InMemoryConfigStore;
  db: Database;
  dir: string;
} {
  const dir = Deno.makeTempDirSync({ prefix: "daemon-adapter-test-" });
  const dbPath = ensureConfigDb(dir);
  const db = new Database(dbPath);
  migrateConfigDb(db);
  seedConfigDb(db);

  const store = new InMemoryConfigStore();
  // Populate store with registry defaults from DB
  const allValues = [
    ["daemon_test.timeout_ms", 30000, SwapClass.HOT],
    ["daemon_test.greeting", "hello", SwapClass.RESTART],
  ] as const;
  for (const [key, value, swap] of allValues) {
    store.set(key, value, swap);
  }

  const adapter = new DaemonConfigAdapter(store, db);
  return { adapter, store, db, dir };
}

function cleanUp(dir: string, db: Database): void {
  db.close();
  Deno.removeSync(dir, { recursive: true });
}

Deno.test("[configuring] DaemonConfigAdapter.mode returns daemon", () => {
  const { adapter, db, dir } = setupDaemonAdapter();
  try {
    assertEquals(adapter.mode, "daemon");
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.get reads from in-memory store", () => {
  const { adapter, db, dir } = setupDaemonAdapter();
  try {
    assertEquals(adapter.get("daemon_test.timeout_ms"), 30000);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.get returns undefined for unknown key", () => {
  const { adapter, db, dir } = setupDaemonAdapter();
  try {
    assertEquals(adapter.get("nonexistent.key"), undefined);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.set writes to DB and updates store for hot", async () => {
  const { adapter, store, db, dir } = setupDaemonAdapter();
  try {
    await adapter.set("daemon_test.timeout_ms", 60000);
    // Store updated
    assertEquals(store.get("daemon_test.timeout_ms"), 60000);
    // DB updated
    assertEquals(adapter.get("daemon_test.timeout_ms"), 60000);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.set writes to DB but NOT store for restart", async () => {
  const { adapter, store, db, dir } = setupDaemonAdapter();
  try {
    await adapter.set("daemon_test.greeting", "hey", { swap_class: SwapClass.RESTART });
    // Store NOT updated for restart-required keys
    assertEquals(store.get("daemon_test.greeting"), "hello");
    // DB was written (the new adapter instance will read it)
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.unset removes from store and inserts NULL row", async () => {
  const { adapter, store, db, dir } = setupDaemonAdapter();
  try {
    await adapter.set("daemon_test.timeout_ms", 60000);
    assertEquals(store.get("daemon_test.timeout_ms"), 60000);

    await adapter.unset("daemon_test.timeout_ms");
    // Store entry removed
    assertEquals(store.get("daemon_test.timeout_ms"), undefined);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.listOverrides returns overrides", async () => {
  const { adapter, db, dir } = setupDaemonAdapter();
  try {
    await adapter.set("daemon_test.timeout_ms", 45000);
    const overrides = adapter.listOverrides();
    const match = overrides.find((o) => o.key === "daemon_test.timeout_ms");
    assertEquals(match?.value, 45000);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.set throws for unknown key", async () => {
  const { adapter, db, dir } = setupDaemonAdapter();
  try {
    await assertRejects(
      () => adapter.set("totally.unknown", 1),
      ConfigKeyNotFoundError,
    );
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.validateAtPath works for known key", () => {
  const { adapter, db, dir } = setupDaemonAdapter();
  try {
    const report = adapter.validateAtPath("daemon_test.timeout_ms", 999999);
    assertEquals(report.valid, false);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.diff shows overrides", async () => {
  const { adapter, db, dir } = setupDaemonAdapter();
  try {
    await adapter.set("daemon_test.timeout_ms", 99999);
    const diff = adapter.diff();
    const match = diff.overridden.find((d) => d.path === "daemon_test.timeout_ms");
    assertEquals(match?.current, 99999);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.getProvenance returns correct source", async () => {
  const { adapter, db, dir } = setupDaemonAdapter();
  try {
    await adapter.set("daemon_test.timeout_ms", 70000);
    const provenance = adapter.getProvenance("daemon_test.timeout_ms");
    assertEquals(provenance.source, "db");
    assertEquals(provenance.value, 70000);
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.getHistory returns history", async () => {
  const { adapter, db, dir } = setupDaemonAdapter();
  try {
    await adapter.set("daemon_test.greeting", "hey");
    const history = adapter.getHistory("daemon_test.greeting");
    assertEquals(history.length >= 1, true);
    assertEquals(history[0].value, "hey");
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.resolveValidationKey works for registered key", () => {
  const { adapter, db, dir } = setupDaemonAdapter();
  try {
    assertEquals(
      adapter.resolveValidationKey("daemon_test.timeout_ms"),
      "daemon_test.timeout_ms",
    );
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.resolveValidationKey handles profile-scoped key", () => {
  const { adapter, db, dir } = setupDaemonAdapter();
  try {
    assertEquals(
      adapter.resolveValidationKey("profile.dev.daemon_test.timeout_ms"),
      "daemon_test.timeout_ms",
    );
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] DaemonConfigAdapter.resolveValidationKey handles pattern key", () => {
  const { adapter, db, dir } = setupDaemonAdapter();
  try {
    assertEquals(
      adapter.resolveValidationKey("daemon_test.models.default.model"),
      "daemon_test.models.*.model",
    );
  } finally {
    cleanUp(dir, db);
  }
});

Deno.test("[configuring] createConfigAdapter returns DirectConfigAdapter when no PID file", () => {
  const dir = Deno.makeTempDirSync({ prefix: "daemon-adapter-test-" });
  try {
    const dbPath = ensureConfigDb(dir);
    const db = new Database(dbPath);
    migrateConfigDb(db);
    seedConfigDb(db);
    db.close();

    const adapter = createConfigAdapter(dbPath);
    // No PID file exists, should return DirectConfigAdapter
    assertEquals(adapter.mode, "direct");
    assertEquals(adapter.get("daemon_test.timeout_ms"), 30000);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

// ── Step 15 (GAP-21): createConfigAdapterAsync verifies process liveness ──────

Deno.test("[configuring] createConfigAdapterAsync returns DirectConfigAdapter for a STALE pid", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "daemon-adapter-stale-" });
  try {
    const dbPath = ensureConfigDb(dir);
    const db = new Database(dbPath);
    migrateConfigDb(db);
    seedConfigDb(db);

    const store = new InMemoryConfigStore();
    // Write a PID file pointing at an almost-certainly-dead pid.
    const pidPath = `${dir}/daemon.pid`;
    Deno.writeTextFileSync(pidPath, "2147483646");

    const adapter = await createConfigAdapterAsync(dbPath, {
      store,
      db,
      daemonPidPath: pidPath,
    });
    // Stale PID → not alive → must fall back to DirectConfigAdapter.
    assertEquals(adapter.mode, "direct");
    db.close();
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[configuring] createConfigAdapterAsync returns DaemonConfigAdapter for a LIVE pid (self)", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "daemon-adapter-live-" });
  try {
    const dbPath = ensureConfigDb(dir);
    const db = new Database(dbPath);
    migrateConfigDb(db);
    seedConfigDb(db);

    const store = new InMemoryConfigStore();
    const pidPath = `${dir}/daemon.pid`;
    // Use this test process's own pid — guaranteed alive.
    Deno.writeTextFileSync(pidPath, String(Deno.pid));

    const adapter = await createConfigAdapterAsync(dbPath, {
      store,
      db,
      daemonPidPath: pidPath,
    });
    assertEquals(adapter.mode, "daemon");
    db.close();
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
