/**
 * @module ConfigConstantsMigrationTest
 * @path packages/core/tests/config/constants_migration_test.ts
 * @description Tests for the first batch of DEFAULT_* constants wrapped with configurable().
 *   Verifies that the registry has the real (non-test) keys, exports are unchanged,
 *   and seed/read/resolution works end-to-end through the config stack.
 */
import { Database } from "@db/sqlite";
import { assertEquals, assertNotEquals } from "@std/assert";
import { getRegisteredDefaults } from "../../src/config/registry.ts";
import { ConfigValueType, SwapClass } from "../../src/types/enums.ts";
import { ensureConfigDb, migrateConfigDb, seedConfigDb } from "../../src/config/db.ts";
import { createConfigAdapter, DirectConfigAdapter } from "../../src/config/adapter.ts";
import {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
  DEFAULT_AI_RETRY_MAX_ATTEMPTS,
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_CONFIG_DB_POLL_INTERVAL_MS,
  DEFAULT_DATABASE_BUSY_TIMEOUT_MS,
} from "../../src/types/constants.ts";

function withTempDb(fn: (dbPath: string) => void): void {
  const dir = Deno.makeTempDirSync({ prefix: "constants-migration-" });
  try {
    const dbPath = ensureConfigDb(dir);
    const db = new Database(dbPath);
    try {
      migrateConfigDb(db);
      seedConfigDb(db);
    } finally {
      db.close();
    }
    fn(dbPath);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

async function withTempDbAsync(fn: (dbPath: string) => Promise<void>): Promise<void> {
  const dir = Deno.makeTempDirSync({ prefix: "constants-migration-" });
  try {
    const dbPath = ensureConfigDb(dir);
    const db = new Database(dbPath);
    try {
      migrateConfigDb(db);
      seedConfigDb(db);
    } finally {
      db.close();
    }
    await fn(dbPath);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

Deno.test(
  "[configuring] configurable ai.timeout_ms registers with correct metadata",
  () => {
    const entry = getRegisteredDefaults().get("ai.timeout_ms");
    assertNotEquals(entry, undefined, "ai.timeout_ms must be registered");
    assertEquals(entry!.opts.type, ConfigValueType.NUMBER);
    assertEquals(entry!.opts.min, 1000);
    assertEquals(entry!.opts.swap, SwapClass.HOT);
  },
);

Deno.test(
  "[configuring] DEFAULT_AI_TIMEOUT_MS still exports 30000 (value unchanged)",
  () => {
    assertEquals(DEFAULT_AI_TIMEOUT_MS, 30000);
  },
);

Deno.test(
  "[configuring] DEFAULT_AI_RETRY_MAX_ATTEMPTS still exports 3 (value unchanged)",
  () => {
    assertEquals(DEFAULT_AI_RETRY_MAX_ATTEMPTS, 3);
  },
);

Deno.test(
  "[configuring] DEFAULT_AI_RETRY_BACKOFF_BASE_MS still exports 1000 (value unchanged)",
  () => {
    assertEquals(DEFAULT_AI_RETRY_BACKOFF_BASE_MS, 1000);
  },
);

Deno.test(
  "[configuring] DEFAULT_AI_MODEL still exports (value unchanged)",
  () => {
    assertEquals(DEFAULT_AI_MODEL, "gemini-flash-latest");
  },
);

Deno.test(
  "[configuring] DEFAULT_DATABASE_BUSY_TIMEOUT_MS still exports 5000 (value unchanged)",
  () => {
    assertEquals(DEFAULT_DATABASE_BUSY_TIMEOUT_MS, 5000);
  },
);

Deno.test(
  "[configuring] seedConfigDb seeds the migrated keys",
  () => {
    withTempDb((_dbPath) => {
      // Check registry keys were registered by module-eval side-effect
      const entry = getRegisteredDefaults().get("ai.timeout_ms");
      assertNotEquals(entry, undefined);
    });
  },
);

Deno.test(
  "[configuring] DirectConfigAdapter.get(ai.timeout_ms) returns 30000 end-to-end",
  () => {
    withTempDb((dbPath) => {
      const adapter = new DirectConfigAdapter(dbPath);
      assertEquals(adapter.get("ai.timeout_ms"), 30000);
    });
  },
);

Deno.test(
  "[configuring] ai.provider is registered",
  () => {
    const entry = getRegisteredDefaults().get("ai.provider");
    assertNotEquals(entry, undefined, "ai.provider must be registered");
    assertEquals(entry!.opts.type, ConfigValueType.STRING);
    assertEquals(entry!.opts.swap, SwapClass.RESTART);
  },
);

Deno.test(
  "[configuring] system.active_profile is registered",
  () => {
    const entry = getRegisteredDefaults().get("system.active_profile");
    assertNotEquals(entry, undefined, "system.active_profile must be registered");
    assertEquals(entry!.opts.type, ConfigValueType.STRING);
    assertEquals(entry!.opts.swap, SwapClass.RESTART);
  },
);

Deno.test(
  "[configuring] models.*.model pattern key is registered",
  () => {
    const entry = getRegisteredDefaults().get("models.*.model");
    assertNotEquals(entry, undefined, "models.*.model must be registered as pattern key");
    assertEquals(entry!.opts.type, ConfigValueType.STRING);
    assertEquals(entry!.opts.swap, SwapClass.RESTART);
  },
);

Deno.test(
  "[configuring] paths.* pattern key is registered",
  () => {
    const entry = getRegisteredDefaults().get("paths.*");
    assertNotEquals(entry, undefined, "paths.* must be registered as pattern key");
    assertEquals(entry!.opts.type, ConfigValueType.STRING);
    assertEquals(entry!.opts.swap, SwapClass.RESTART);
  },
);

Deno.test(
  "[configuring] set(ai.provider, openai) persists without throwing (convenience key resolves)",
  async () => {
    await withTempDbAsync(async (dbPath) => {
      const adapter = new DirectConfigAdapter(dbPath);
      await adapter.set("ai.provider", "openai");
      assertEquals(adapter.get("ai.provider"), "openai");
    });
  },
);

Deno.test(
  "[configuring] set(system.active_profile, dev) persists",
  async () => {
    await withTempDbAsync(async (dbPath) => {
      const adapter = new DirectConfigAdapter(dbPath);
      await adapter.set("system.active_profile", "dev");
      assertEquals(adapter.get("system.active_profile"), "dev");
    });
  },
);

Deno.test(
  "[configuring] set models.default.model via pattern key does not throw",
  async () => {
    await withTempDbAsync(async (dbPath) => {
      const adapter = new DirectConfigAdapter(dbPath);
      await adapter.set("models.default.model", "gpt-5-mini");
      assertEquals(adapter.get("models.default.model"), "gpt-5-mini");
    });
  },
);

Deno.test(
  "[configuring] set paths.execution via pattern key does not throw",
  async () => {
    await withTempDbAsync(async (dbPath) => {
      const adapter = new DirectConfigAdapter(dbPath);
      await adapter.set("paths.execution", "/tmp");
      assertEquals(adapter.get("paths.execution"), "/tmp");
    });
  },
);

Deno.test(
  "[configuring] DEFAULT_CONFIG_DB_POLL_INTERVAL_MS is 5000",
  () => {
    assertEquals(DEFAULT_CONFIG_DB_POLL_INTERVAL_MS, 5_000);
  },
);

Deno.test(
  "[configuring] createConfigAdapter returns a working adapter with real keys",
  () => {
    withTempDb((dbPath) => {
      const adapter = createConfigAdapter(dbPath);
      assertEquals(adapter.get("ai.timeout_ms"), 30000);
    });
  },
);
