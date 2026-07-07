/**
 * @module ConfigCommandsTest
 * @path apps/exactl/tests/config_commands_test.ts
 * @description Tests for ConfigCommands convenience methods — set-model,
 *   set-provider, set-path, diff, show --sources, and profile support.
 */
import { Database } from "@db/sqlite";
import { assertEquals, assertRejects } from "@std/assert";
import { createConfigAdapter, ensureConfigDb, migrateConfigDb, seedConfigDb } from "@exaix/core/config";
import { ConfigValidationError } from "@exaix/core/config";

import type { IConfigAdapter } from "@exaix/core/config";
import { createMockConfig, createStubConfig, createStubContext, createTestConfigDb } from "@exaix/testing";
import { ConfigCommands } from "../src/commands/config_commands.ts";

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

// ── Step 12 (GAP-18): --profile scoping on ConfigCommands.get/set ──────────

/** Build a ConfigCommands wired to a seeded temp Config DB (matches config_cli_test). */
function withProfileCommands(fn: (commands: ConfigCommands) => Promise<void> | void): Promise<void> {
  const dir = Deno.makeTempDirSync({ prefix: "config-profile-" });
  return (async () => {
    try {
      createTestConfigDb(dir);
      const configService = createStubConfig(createMockConfig(dir));
      const context = createStubContext({ config: configService });
      const commands = new ConfigCommands(context);
      await fn(commands);
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  })();
}

Deno.test("[configuring-cli] set --profile persists profile.<name>.<key>", async () => {
  await withProfileCommands(async (commands) => {
    await commands.set("ai.timeout_ms", "60000", "dev");
    // Reads back through the same profile-scoped key.
    assertEquals(await commands.get("ai.timeout_ms", "dev"), 60000);
  });
});

Deno.test("[configuring-cli] set --profile rejects a value below the base-key min", async () => {
  await withProfileCommands(async (commands) => {
    // ai.timeout_ms has min 1000; a profile-scoped write validates against that.
    await assertRejects(
      () => commands.set("ai.timeout_ms", "500", "dev"),
      ConfigValidationError,
    );
  });
});

Deno.test("[configuring-cli] get --profile returns the profile-scoped value, not the global", async () => {
  await withProfileCommands(async (commands) => {
    await commands.set("ai.timeout_ms", "70000", "dev");
    await commands.set("ai.timeout_ms", "20000"); // global (no profile)
    assertEquals(await commands.get("ai.timeout_ms", "dev"), 70000);
    assertEquals(await commands.get("ai.timeout_ms"), 20000);
  });
});
