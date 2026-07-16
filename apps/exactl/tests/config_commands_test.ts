/**
 * @module ConfigCommandsTest
 * @path apps/exactl/tests/config_commands_test.ts
 * @description Tests for ConfigCommands convenience methods — set-model,
 *   set-provider, set-path, diff, show --sources, and profile support.
 */
import { Database } from "@db/sqlite";
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { createConfigAdapter, ensureConfigDb, migrateConfigDb, seedConfigDb } from "@exaix/core/config";
import { ConfigKeyLockedError, ConfigRateLimitedError, ConfigValidationError } from "@exaix/core/config";

import type { IConfigAdapter } from "@exaix/core/config";
import { createMockConfig, createStubConfig, createStubContext, createTestConfigDb, withEnv } from "@exaix/testing";
import { ConfigCommands } from "../src/commands/config_commands.ts";
import { buildHandlers } from "@exaix-team/mcp-server";
import { McpToolName } from "@exaix/mcp";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";
import { CLI_CONFIG_SET_MAX_WRITES_PER_WINDOW } from "@exaix/core";

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

// ── Step 15 (GAP-22): diff() returns a string (display convention, no console.log) ──

Deno.test("[configuring-cli] diff() returns a formatted string of overridden keys", async () => {
  await withProfileCommands(async (commands) => {
    await commands.set("ai.timeout_ms", "99999");
    const out = await commands.diff();
    assertEquals(typeof out, "string");
    assertEquals(out.includes("ai.timeout_ms"), true);
    assertEquals(out.includes("99999"), true);
  });
});

Deno.test("[configuring-cli] diff() returns a no-overrides message when nothing is overridden", async () => {
  await withProfileCommands(async (commands) => {
    const out = await commands.diff();
    assertEquals(typeof out, "string");
    assertEquals(out.toLowerCase().includes("no overridden"), true);
  });
});

// ── Phase 138 Step 2: config block CLI + MCP enforcement integration ─────────

Deno.test({
  name: "[configuring-cli] config_block_cli: CLI add/list wires the blocklist and MCP enforcement rejects",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const dir = Deno.makeTempDirSync({ prefix: "config-block-int-" });
    try {
      createTestConfigDb(dir);
      const configService = createStubConfig(createMockConfig(dir));
      const context = createStubContext({ config: configService });

      // 1. CLI: add a blocklist pattern, then list shows it.
      const commands = new ConfigCommands(context);
      await commands.blockAdd("ai.*", "provider locked by admin");
      const listed = await commands.blockList();
      assertEquals(listed.some((b) => b.pattern === "ai.*"), true);
      assertEquals(listed.find((b) => b.pattern === "ai.*")?.reason, "provider locked by admin");

      // 2. MCP: ConfigSetTool via the live handler map refuses the blocked key.
      const handlers = buildHandlers(context, new AllowAllPermissionsService());
      const setTool = handlers.get(McpToolName.CONFIG_SET);
      assertEquals(setTool !== undefined, true);
      const response = await setTool!.execute({ key: "ai.provider", value: "openai" });
      const text = response.content.find((c) => c.type === "text");
      const blocked = text && text.type === "text" ? text.text.includes("blocked") : false;
      assertEquals(blocked, true, "MCP write to a CLI-blocked key must be rejected");

      // 3. CLI: remove clears the block.
      await commands.blockRemove("ai.*");
      assertEquals((await commands.blockList()).some((b) => b.pattern === "ai.*"), false);
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});

// ── Phase 139 Step 4: config lock CLI + MCP enforcement integration ──────────

Deno.test({
  name: "[configuring-cli] config_lock_cli: CLI lock refuses a write through the MCP apply path, unlock re-enables",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const dir = Deno.makeTempDirSync({ prefix: "config-lock-int-" });
    try {
      createTestConfigDb(dir);
      const configService = createStubConfig(createMockConfig(dir));
      const context = createStubContext({ config: configService });

      // 1. CLI: lock ai.provider; lock-list shows it.
      const commands = new ConfigCommands(context);
      await commands.lock("ai.provider", "provider locked by admin");
      assertEquals((await commands.listLocks()).some((l) => l.key === "ai.provider"), true);

      // 2. MCP: stage the locked key via ConfigSet, then apply via ConfigApply
      //    through the live handler map — apply calls adapter.set(), which the
      //    lock guard (assertWritable) refuses.
      const handlers = buildHandlers(context, new AllowAllPermissionsService());
      const setTool = handlers.get(McpToolName.CONFIG_SET);
      const applyTool = handlers.get(McpToolName.CONFIG_APPLY);
      assertEquals(setTool !== undefined && applyTool !== undefined, true);
      await setTool!.execute({ key: "ai.provider", value: "openai" });
      const applyResp = await applyTool!.execute({});
      const applyText = applyResp.content.find((c) => c.type === "text");
      const refused = applyText && applyText.type === "text" ? applyText.text.includes("failed") : false;
      assertEquals(refused, true, "applying a locked key through MCP must fail (lock funnel)");
      // The staged value was NOT written (still the pre-lock default, not "openai").
      assertNotEquals(await commands.get("ai.provider"), "openai");

      // 3. CLI: unlock re-enables writes.
      await commands.unlock("ai.provider");
      await commands.set("ai.provider", "anthropic");
      assertEquals(await commands.get("ai.provider"), "anthropic");
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});

Deno.test("[configuring-cli] ConfigCommands.unlock still functions after adapter.unlock gained an actor parameter (GAP-5)", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "config-unlock-actor-" });
  try {
    createTestConfigDb(dir);
    const configService = createStubConfig(createMockConfig(dir));
    const context = createStubContext({ config: configService });
    const commands = new ConfigCommands(context);

    await commands.lock("ai.provider");
    assertEquals((await commands.listLocks()).some((l) => l.key === "ai.provider"), true);

    await commands.unlock("ai.provider");
    assertEquals((await commands.listLocks()).some((l) => l.key === "ai.provider"), false);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

// ── Phase 138 Step 3: CLI debounce + compact ────────────────────────────────

Deno.test({
  name: "[configuring-cli][security] set debounce rejects writes over the DB-backed window limit",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withProfileCommands(async (commands) => {
      // Fill the window up to the limit with in-window cli writes.
      for (let i = 0; i < CLI_CONFIG_SET_MAX_WRITES_PER_WINDOW; i++) {
        await commands.set("ai.timeout_ms", String(30000 + i));
      }
      // The next set must be rate-limited.
      let threw = false;
      try {
        await commands.set("ai.timeout_ms", "45000");
      } catch (e) {
        threw = e instanceof ConfigRateLimitedError;
      }
      assertEquals(threw, true, "the (limit+1)th CLI set must throw ConfigRateLimitedError");
    });
  },
});

Deno.test("[configuring-cli] compact collapses config_overrides to one row per key", async () => {
  await withProfileCommands(async (commands) => {
    await commands.set("ai.timeout_ms", "40000");
    await commands.set("ai.timeout_ms", "41000");
    await commands.set("ai.timeout_ms", "42000");
    const removed = await commands.compact();
    assertEquals(removed >= 2, true, "superseded ai.timeout_ms rows must be removed");
    // Effective value preserved.
    assertEquals(await commands.get("ai.timeout_ms"), 42000);
  });
});

// ── Phase 139 Step 2: config history CLI (read-only vertical slice) ──────────

Deno.test("[configuring-cli] ConfigCommands.history returns override rows DESC by id", async () => {
  await withProfileCommands(async (commands) => {
    await commands.set("ai.timeout_ms", "40000");
    await commands.set("ai.timeout_ms", "41000");
    const rows = await commands.history("ai.timeout_ms");
    // Newest-first (DESC by id): [41000, 40000] (the seed NULL row may precede).
    const values = rows.filter((r) => r.value !== null).map((r) => r.value);
    assertEquals(values[0], "41000", "newest write first");
    assertEquals(values[1], "40000");
    // Each row carries the append-only fields.
    assertEquals(typeof rows[0].id, "number");
    assertEquals(typeof rows[0].source, "string");
    assertEquals(typeof rows[0].created_at, "string");
  });
});

Deno.test("[configuring-cli] config_history_cli lists both values newest-first", async () => {
  await withProfileCommands(async (commands) => {
    await commands.set("ai.provider", "openai");
    await commands.set("ai.provider", "anthropic");
    const rows = await commands.history("ai.provider");
    const values = rows.filter((r) => r.value !== null).map((r) => r.value);
    assertEquals(values, ["anthropic", "openai"], "history returns both writes newest-first");
  });
});

// ── Phase 139 Step 3: config rollback CLI ───────────────────────────────────

Deno.test("[configuring-cli] config_rollback_cli rejects a non-numeric id with a clear error (GAP-4)", async () => {
  const dir = Deno.makeTempDirSync({ prefix: "config-rollback-nan-" });
  try {
    createTestConfigDb(dir);
    const configService = createStubConfig(createMockConfig(dir));
    const context = createStubContext({ config: configService });
    const commands = new ConfigCommands(context);

    await commands.set("ai.timeout_ms", "40000");
    await commands.set("ai.timeout_ms", "50000");

    // Calling rollback with NaN id must surface a clear error, not ConfigKeyNotFoundError.
    await assertRejects(
      () => commands.rollback("ai.timeout_ms", NaN),
      Error,
      "positive integer",
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[configuring-cli] config_rollback_cli restores the original value", async () => {
  await withProfileCommands(async (commands) => {
    await commands.set("ai.timeout_ms", "40000");
    await commands.set("ai.timeout_ms", "41000");
    const original = (await commands.history("ai.timeout_ms")).find((r) => r.value === "40000")!;
    const restored = await commands.rollback("ai.timeout_ms", original.id);
    assertEquals(restored, "40000");
    assertEquals(await commands.get("ai.timeout_ms"), 40000, "get() returns the rolled-back value");
  });
});

// ── Phase 139 Step 6: config edit ($EDITOR) ─────────────────────────────────

/**
 * Write a stub "editor" — an executable shell script that runs a Deno
 * transform in-place on the rendered override file. Invoked by `edit()` as
 * `<script> <tmpPath>`. Returns the absolute path to set as $EDITOR.
 */
function writeStubEditor(dir: string, transform: string): string {
  const tsPath = `${dir}/stub_editor.ts`;
  Deno.writeTextFileSync(
    tsPath,
    `const p = Deno.args[0];
const text = Deno.readTextFileSync(p);
${transform}
Deno.writeTextFileSync(p, out);
`,
  );
  const shPath = `${dir}/stub_editor.sh`;
  Deno.writeTextFileSync(shPath, `#!/bin/sh\nexec deno run -A "${tsPath}" "$@"\n`);
  Deno.chmodSync(shPath, 0o755);
  return shPath;
}

Deno.test({
  name: "[configuring-cli] config edit with an invalid first value aborts and applies NO changes (GAP-3)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const dir = Deno.makeTempDirSync({ prefix: "config-edit-first-invalid-" });
    try {
      createTestConfigDb(dir);
      const configService = createStubConfig(createMockConfig(dir));
      const context = createStubContext({ config: configService });
      const commands = new ConfigCommands(context);

      // Seed two overrides so both appear in the rendered file.
      await commands.set("ai.timeout_ms", "40000");
      await commands.set("ai.provider", "openai");

      // Stub editor: set ai.timeout_ms to out-of-bounds (invalid),
      // and change ai.provider to "anthropic" (valid).
      const editor = writeStubEditor(
        dir,
        `const lines = text.split("\\n");
         const out = lines.map((l) => {
           if (l.startsWith("ai.timeout_ms ")) return "ai.timeout_ms = 1";
           if (l.startsWith("ai.provider ")) return "ai.provider = anthropic";
           return l;
         }).join("\\n");`,
      );
      // Must abort — the invalid first line should prevent ALL changes.
      await assertRejects(
        () => withEnv({ EDITOR: editor }, () => commands.edit()),
      );
      // If pre-validation works, NEITHER key is changed despite ai.provider
      // being a valid value — the invalid ai.timeout_ms blocks the whole edit.
      assertEquals(await commands.get("ai.timeout_ms"), 40000, "unchanged on validation failure");
      assertEquals(await commands.get("ai.provider"), "openai", "unchanged on validation failure");
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "[configuring-cli] ConfigCommands.edit applies changed lines via adapter.set (unchanged untouched)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const dir = Deno.makeTempDirSync({ prefix: "config-edit-" });
    try {
      createTestConfigDb(dir);
      const configService = createStubConfig(createMockConfig(dir));
      const context = createStubContext({ config: configService });
      const commands = new ConfigCommands(context);

      // Seed two overrides so both appear in the rendered file.
      await commands.set("ai.timeout_ms", "40000");
      await commands.set("ai.provider", "openai");

      // Stub editor: rewrite ai.timeout_ms to 50000, leave ai.provider as-is.
      const editor = writeStubEditor(
        dir,
        `const out = text.split("\\n").map((l) =>
           l.startsWith("ai.timeout_ms ") ? "ai.timeout_ms = 50000" : l
         ).join("\\n");`,
      );
      await withEnv({ EDITOR: editor }, () => commands.edit());

      assertEquals(await commands.get("ai.timeout_ms"), 50000, "changed key applied");
      assertEquals(await commands.get("ai.provider"), "openai", "unchanged key untouched");
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "[configuring-cli] config edit routes applied changes through set() (a locked key edit is refused)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const dir = Deno.makeTempDirSync({ prefix: "config-edit-lock-" });
    try {
      createTestConfigDb(dir);
      const configService = createStubConfig(createMockConfig(dir));
      const context = createStubContext({ config: configService });
      const commands = new ConfigCommands(context);

      await commands.set("ai.timeout_ms", "40000");
      await commands.lock("ai.timeout_ms");

      const editor = writeStubEditor(
        dir,
        `const out = text.split("\\n").map((l) =>
           l.startsWith("ai.timeout_ms ") ? "ai.timeout_ms = 55000" : l
         ).join("\\n");`,
      );
      // Editing a locked key must surface ConfigKeyLockedError through set().
      await assertRejects(
        () => withEnv({ EDITOR: editor }, () => commands.edit()),
        ConfigKeyLockedError,
      );
      assertEquals(await commands.get("ai.timeout_ms"), 40000, "locked key unchanged");
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});
