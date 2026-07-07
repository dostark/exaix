/**
 * @module TestingPackageConfigHelpersTest
 * @path packages/testing/tests/config_helpers_test.ts
 * @related-files ["packages/testing/src/helpers/config.ts"]
 * @architectural-layer Testing
 * @description Verifies the Config DB test helpers in @exaix/testing —
 *   createTestConfigDb, createTestAdapter, and simulateDaemonBoot — are wired
 *   to a real DirectConfigAdapter over a seeded, isolated Config DB.
 */
import { Database } from "@db/sqlite";
import { assertEquals } from "@std/assert";
import { createTestAdapter, createTestConfigDb, simulateDaemonBoot } from "@exaix/testing";
import { configurable } from "@exaix/core/config";
import { ConfigValueType } from "@exaix/core/types";
import { join } from "@std/path";

configurable({
  key: "helper_test.timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Config helper test timeout",
  min: 1000,
  max: 120000,
});

function tempDir(): { dir: string; cleanup: () => void } {
  const dir = Deno.makeTempDirSync({ prefix: "config-helper-" });
  return { dir, cleanup: () => Deno.removeSync(dir, { recursive: true }) };
}

Deno.test("createTestConfigDb creates a seeded config_overrides table", () => {
  const { dir, cleanup } = tempDir();
  try {
    const dbPath = createTestConfigDb(dir);
    const db = new Database(dbPath);
    try {
      const cols = db.prepare("PRAGMA table_info(config_overrides)").all();
      assertEquals(cols.length > 0, true);
      const row = db.prepare(
        "SELECT COUNT(*) as cnt FROM config_overrides WHERE key = ?",
      ).get<{ cnt: number }>("helper_test.timeout_ms");
      assertEquals((row?.cnt ?? 0) >= 1, true);
    } finally {
      db.close();
    }
  } finally {
    cleanup();
  }
});

Deno.test("createTestAdapter returns a working DirectConfigAdapter", async () => {
  const { dir, cleanup } = tempDir();
  try {
    const adapter = createTestAdapter(dir);
    assertEquals(adapter.get("helper_test.timeout_ms"), 30000);
    await adapter.set("helper_test.timeout_ms", 60000);
    assertEquals(adapter.get("helper_test.timeout_ms"), 60000);
  } finally {
    cleanup();
  }
});

Deno.test("simulateDaemonBoot writes bootstrap TOML and returns a seeded adapter", () => {
  const { dir, cleanup } = tempDir();
  try {
    const adapter = simulateDaemonBoot(dir);
    assertEquals(adapter.get("helper_test.timeout_ms"), 30000);
    // Bootstrap TOML was written to the temp dir.
    const tomlStat = Deno.statSync(join(dir, "exa.config.toml"));
    assertEquals(tomlStat.isFile, true);
  } finally {
    cleanup();
  }
});
