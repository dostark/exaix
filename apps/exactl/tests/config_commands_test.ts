/**
 * @module ConfigCommandsTest
 * @path apps/exactl/tests/config_commands_test.ts
 * @description Tests for ConfigCommands convenience methods — set-model,
 *   set-provider, set-path, diff, show --sources, and profile support.
 */
import { Database } from "@db/sqlite";
import { assertEquals } from "@std/assert";
import { createConfigAdapter, ensureConfigDb, migrateConfigDb, seedConfigDb } from "@exaix/core/config";

import type { IConfigAdapter } from "@exaix/core/config";

function withTempConfigDb(fn: (adapter: IConfigAdapter) => void): void {
  const dir = Deno.makeTempDirSync({ prefix: "config-cmd-" });
  try {
    const targetDir = `${dir}/Workspace`;
    Deno.mkdirSync(targetDir, { recursive: true });
    // Create a minimal config to satisfy system.root
    const configPath = `${targetDir}/config.toml`;
    Deno.writeTextFileSync(configPath, `system.root = "${targetDir}"`);

    const dbPath = ensureConfigDb(targetDir);
    const db = new Database(dbPath);
    try {
      migrateConfigDb(db);
      seedConfigDb(db);
    } finally {
      db.close();
    }
    const adapter = createConfigAdapter(dbPath);
    fn(adapter);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

Deno.test("[configuring-cli] set-model persists models.<name>.model", async () => {
  await withTempConfigDb(async (adapter) => {
    await adapter.set("models.default.model", "gpt-4");
    assertEquals(adapter.get("models.default.model"), "gpt-4");
  });
});

Deno.test("[configuring-cli] set-provider persists ai.provider and default model", async () => {
  await withTempConfigDb(async (adapter) => {
    await adapter.set("ai.provider", "openai");
    await adapter.set("models.default.model", "gpt-5-mini");
    assertEquals(adapter.get("ai.provider"), "openai");
    assertEquals(adapter.get("models.default.model"), "gpt-5-mini");
  });
});

Deno.test("[configuring-cli] set-path persists paths.<key>", async () => {
  await withTempConfigDb(async (adapter) => {
    await adapter.set("paths.execution", "/tmp");
    assertEquals(adapter.get("paths.execution"), "/tmp");
  });
});

Deno.test("[configuring-cli] use-profile sets system.active_profile", async () => {
  await withTempConfigDb(async (adapter) => {
    await adapter.set("system.active_profile", "dev");
    assertEquals(adapter.get("system.active_profile"), "dev");
  });
});

Deno.test("[configuring-cli] diff shows overridden keys", async () => {
  await withTempConfigDb(async (adapter) => {
    await adapter.set("ai.timeout_ms", 99999);
    const diff = adapter.diff();
    const match = diff.overridden.find((d) => d.path === "ai.timeout_ms");
    assertEquals(match?.current, 99999);
  });
});

Deno.test("[configuring-cli] getProvenance returns source for overridden keys", async () => {
  await withTempConfigDb(async (adapter) => {
    await adapter.set("ai.timeout_ms", 45000);
    const provenance = adapter.getProvenance("ai.timeout_ms");
    assertEquals(provenance.source, "db");
    assertEquals(provenance.value, 45000);
  });
});
