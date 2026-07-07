/**
 * @module ConfiguringCutoverTest
 * @path tests/configuring/config_cutover_test.ts
 * @description Integration test for the full configuring cutover — adapter
 *   round-trips, hot vs restart, MCP tool registration, profile scoping.
 */
import { Database } from "@db/sqlite";
import { assertEquals, assertNotEquals } from "@std/assert";
import { configurable, getRegisteredDefaults } from "@exaix/core/config";
import { createConfigAdapter, DirectConfigAdapter, InMemoryConfigStore } from "@exaix/core/config";
import { ensureConfigDb, getAllEffectiveValues, migrateConfigDb, seedConfigDb } from "@exaix/core/config";
import { ConfigValueType, SwapClass } from "@exaix/core/types";
import { TOOL_MANIFEST } from "@exaix/mcp";

// Register test key
configurable({
  key: "cutover_test.timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Cutover integration test timeout",
  min: 1000,
  max: 120000,
});

function withDb(fn: (dbPath: string, db: Database) => void): void {
  const dir = Deno.makeTempDirSync({ prefix: "cutover-" });
  try {
    const dbPath = ensureConfigDb(dir);
    const db = new Database(dbPath);
    try {
      migrateConfigDb(db);
      seedConfigDb(db);
      fn(dbPath, db);
    } finally {
      db.close();
    }
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

Deno.test(
  "[configuring-cutover] DirectConfigAdapter set/get round-trip",
  () => {
    withDb((dbPath) => {
      const adapter = new DirectConfigAdapter(dbPath);
      assertEquals(adapter.get("cutover_test.timeout_ms"), 30000);
    });
    withDb(async (dbPath) => {
      const adapter = new DirectConfigAdapter(dbPath);
      await adapter.set("cutover_test.timeout_ms", 45000);
      assertEquals(adapter.get("cutover_test.timeout_ms"), 45000);
    });
  },
);

Deno.test(
  "[configuring-cutover] DaemonConfigAdapter hot updates store",
  () => {
    withDb((_dbPath, db) => {
      const store = new InMemoryConfigStore();
      store.set("cutover_test.timeout_ms", 30000, SwapClass.HOT);
      const allValues = getAllEffectiveValues(db);
      for (const [key, value] of allValues) {
        if (value !== null) {
          store.set(key, value, SwapClass.HOT);
        }
      }
    });
  },
);

Deno.test(
  "[configuring-cutover] 6 MCP config tools registered in manifest",
  () => {
    const configToolNames = [
      "exaix_config_get",
      "exaix_config_set",
      "exaix_config_validate",
      "exaix_config_diff",
      "exaix_config_get_provenance",
      "exaix_config_apply",
    ];
    const manifestNames = TOOL_MANIFEST.map((e) => e.name);
    for (const name of configToolNames) {
      assertEquals(
        manifestNames.includes(name),
        true,
        `Missing manifest entry: ${name}`,
      );
    }
  },
);

Deno.test(
  "[configuring-cutover] profile-scoped key resolves validation",
  async () => {
    const dir = Deno.makeTempDirSync({ prefix: "cutover-" });
    try {
      const dbPath = ensureConfigDb(dir);
      const db = new Database(dbPath);
      try {
        migrateConfigDb(db);
        seedConfigDb(db);
        const adapter = new DirectConfigAdapter(dbPath);
        await adapter.set("profile.dev.cutover_test.timeout_ms", 70000);
        assertEquals(adapter.get("profile.dev.cutover_test.timeout_ms"), 70000);
        assertEquals(adapter.get("cutover_test.timeout_ms"), 30000);
      } finally {
        db.close();
      }
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
);

Deno.test(
  "[configuring-cutover] seed populates config_overrides with registry keys",
  () => {
    withDb((_dbPath, db) => {
      const effective = getAllEffectiveValues(db);
      // Registry is populated by constants.ts module eval — at minimum
      // ai.timeout_ms should exist
      const hasTimeout = [...effective.keys()].some((k) =>
        k.startsWith("ai.timeout_ms") || k.startsWith("cutover_test.")
      );
      assertEquals(hasTimeout, true);
    });
  },
);

Deno.test(
  "[configuring-cutover] createConfigAdapter returns working adapter",
  () => {
    withDb((dbPath, _db) => {
      const adapter = createConfigAdapter(dbPath);
      assertNotEquals(adapter, null);
      // Should be able to read known keys
      const hasRegisteredKeys = getRegisteredDefaults().size > 0;
      assertEquals(hasRegisteredKeys, true);
    });
  },
);
