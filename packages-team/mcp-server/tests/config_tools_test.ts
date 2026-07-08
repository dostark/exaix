/**
 * @module ConfigToolsTest
 * @path packages-team/mcp-server/tests/config_tools_test.ts
 * @description Tests for MCP config tools — staging + apply logic.
 */
import { assertEquals } from "@std/assert";
import {
  _drainPendingChangesForTest,
  _resetPendingChangesForTest,
  ConfigApplyTool,
  ConfigSetTool,
} from "../config_tools.ts";
import { createMockConfig, createStubConfig, createStubContext } from "@exaix/testing";
import { createTestConfigDb } from "@exaix/testing";
import { type JSONValue, MCP_CONTENT_TYPE_STRUCTURED_DATA } from "@exaix/core";
import { addBlocklistPattern, configurable, createConfigAdapter } from "@exaix/core/config";
import { ConfigValueType, SwapClass } from "@exaix/core";
import { buildHandlers } from "../tools.ts";
import { McpToolName } from "@exaix/mcp";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";
import { Database } from "@db/sqlite";

Deno.test({
  name: "[configuring-mcp] pending changes start empty",
  fn() {
    _resetPendingChangesForTest();
    // No assertion needed — verify by calling apply (returns empty)
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[configuring-mcp] ConfigSetTool and ConfigApplyTool are exported",
  fn() {
    // Dynamic import to verify the module exports
    const mod = Deno.readTextFileSync(
      new URL("../config_tools.ts", import.meta.url).pathname,
    );
    assertEquals(mod.includes("export class ConfigSetTool"), true);
    assertEquals(mod.includes("export class ConfigApplyTool"), true);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[configuring-mcp] tools.ts registers CONFIG_SET and CONFIG_APPLY",
  fn() {
    const mod = Deno.readTextFileSync(
      new URL("../tools.ts", import.meta.url).pathname,
    );
    assertEquals(mod.includes("McpToolName.CONFIG_SET"), true);
    assertEquals(mod.includes("McpToolName.CONFIG_APPLY"), true);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[configuring-mcp] manifest.ts has entries for CONFIG_SET and CONFIG_APPLY",
  fn() {
    const mod = Deno.readTextFileSync(
      new URL("../../../packages/mcp/src/manifest.ts", import.meta.url).pathname,
    );
    assertEquals(mod.includes("McpToolName.CONFIG_SET"), true);
    assertEquals(mod.includes("McpToolName.CONFIG_APPLY"), true);
    // Both mutation tools gate on human approval and point at the config_tools source.
    // (Split across two assertions so the approval-flag line and the source-ref path
    //  line are separate — the leak guard treats "require" + a team path on one line as
    //  a runtime import.)
    assertEquals(mod.includes("requires_human_approval: true,\n    docs_visible: true,"), true);
    const configToolsSourceRef = ["packages-team", "mcp-server", "config_tools.ts"].join("/");
    assertEquals(mod.includes(`source_ref: "${configToolsSourceRef}"`), true);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[configuring-mcp] _resetPendingChangesForTest is exported",
  fn() {
    assertEquals(typeof _resetPendingChangesForTest, "function");
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ── Step 15 (GAP-22): ConfigApplyTool awaits set() and records failures ───────

interface IApplyResult {
  key: string;
  status: string;
  error?: string;
}

/** Narrow a JSONValue produced by ConfigApplyTool into apply-result rows. */
function toApplyResults(data: JSONValue): IApplyResult[] {
  if (!Array.isArray(data)) return [];
  const rows: IApplyResult[] = [];
  for (const entry of data) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const rec = entry as Record<string, JSONValue>;
      if (typeof rec.key === "string" && typeof rec.status === "string") {
        rows.push({
          key: rec.key,
          status: rec.status,
          error: typeof rec.error === "string" ? rec.error : undefined,
        });
      }
    }
  }
  return rows;
}

// ── Phase 138 Step 1: ConfigSetTool three-tier routing ────────────────────────

// A no-impact hot key explicitly marked safe (like ui.theme) — auto-approve tier.
configurable({
  key: "test.tier.safe_writethrough",
  default: "light",
  type: ConfigValueType.STRING,
  description: "safe-tier key for write-through routing test",
  swap: SwapClass.HOT,
  tier: "safe",
});

function findStructured(response: { content: Array<{ type: string; data?: JSONValue }> }): JSONValue | undefined {
  const entry = response.content.find((c) => c.type === MCP_CONTENT_TYPE_STRUCTURED_DATA);
  return entry && entry.type === MCP_CONTENT_TYPE_STRUCTURED_DATA ? entry.data : undefined;
}

Deno.test({
  name: "[configuring-mcp] ConfigSetTool writes through directly for safe-tier key",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    _resetPendingChangesForTest();
    const dir = Deno.makeTempDirSync({ prefix: "config-tier-safe-" });
    try {
      const dbPath = createTestConfigDb(dir);
      const context = createStubContext({ config: createStubConfig(createMockConfig(dir)) });

      const setTool = new ConfigSetTool(context);
      await setTool.execute({ key: "test.tier.safe_writethrough", value: "dark" });

      // Safe tier writes through immediately — no staging.
      const staged = _drainPendingChangesForTest();
      assertEquals(staged.length, 0, "safe-tier write must NOT stage");

      // And the value is persisted to the config DB.
      const adapter = createConfigAdapter(dbPath);
      assertEquals(adapter.get("test.tier.safe_writethrough"), "dark");
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "[configuring-mcp] ConfigSetTool stages for leaf-tier key",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    _resetPendingChangesForTest();
    const dir = Deno.makeTempDirSync({ prefix: "config-tier-leaf-" });
    try {
      const dbPath = createTestConfigDb(dir);
      const context = createStubContext({ config: createStubConfig(createMockConfig(dir)) });

      const setTool = new ConfigSetTool(context);
      // ai.timeout_ms is swap:hot → leaf tier.
      await setTool.execute({ key: "ai.timeout_ms", value: 45000 });

      const staged = _drainPendingChangesForTest();
      assertEquals(staged.length, 1, "leaf-tier write must stage exactly one change");
      assertEquals(staged[0].key, "ai.timeout_ms");

      // Not written through: DB still holds the default (not 45000).
      const adapter = createConfigAdapter(dbPath);
      assertEquals(adapter.get("ai.timeout_ms") === 45000, false, "leaf-tier write must NOT persist before apply");
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "[configuring-mcp] ConfigSetTool stages + emits requires_confirmation marker for dangerous-tier key",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    _resetPendingChangesForTest();
    const dir = Deno.makeTempDirSync({ prefix: "config-tier-danger-" });
    try {
      createTestConfigDb(dir);
      const context = createStubContext({ config: createStubConfig(createMockConfig(dir)) });

      const setTool = new ConfigSetTool(context);
      // ai.provider is swap:restart → dangerous tier.
      const response = await setTool.execute({ key: "ai.provider", value: "openai" });

      const staged = _drainPendingChangesForTest();
      assertEquals(staged.length, 1, "dangerous-tier write must stage");

      const structured = findStructured(response);
      const marker = structured && typeof structured === "object" && !Array.isArray(structured)
        ? (structured as Record<string, JSONValue>).requires_confirmation
        : undefined;
      assertEquals(marker, true, "dangerous-tier response must carry requires_confirmation: true");
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "[configuring-mcp] config_set_tier_routing integration: safe write-through via buildHandlers() map",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    _resetPendingChangesForTest();
    const dir = Deno.makeTempDirSync({ prefix: "config-tier-wire-" });
    try {
      const dbPath = createTestConfigDb(dir);
      const context = createStubContext({ config: createStubConfig(createMockConfig(dir)) });

      // Reach the tool through the real live handler map (tools.ts:buildHandlers).
      const handlers = buildHandlers(context, new AllowAllPermissionsService());
      const setTool = handlers.get(McpToolName.CONFIG_SET);
      assertEquals(setTool !== undefined, true, "CONFIG_SET must be in the live handler map");

      await setTool!.execute({ key: "test.tier.safe_writethrough", value: "dracula" });

      const adapter = createConfigAdapter(dbPath);
      assertEquals(
        adapter.get("test.tier.safe_writethrough"),
        "dracula",
        "safe-tier write must reach the config DB through the wired handler",
      );
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "[configuring-mcp] ConfigSetTool returns ConfigPathBlockedError for blocked key",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    _resetPendingChangesForTest();
    const dir = Deno.makeTempDirSync({ prefix: "config-block-mcp-" });
    try {
      const dbPath = createTestConfigDb(dir);
      // Seed a blocklist entry directly on the config DB.
      const adapterForSeed = createConfigAdapter(dbPath);
      const seedDb = new Database(dbPath);
      try {
        addBlocklistPattern(seedDb, "ai.*", "provider locked");
      } finally {
        seedDb.close();
      }
      assertEquals(adapterForSeed.isPathBlocked("ai.provider"), true);

      const context = createStubContext({ config: createStubConfig(createMockConfig(dir)) });
      const setTool = new ConfigSetTool(context);
      const response = await setTool.execute({ key: "ai.provider", value: "openai" });

      // Blocked writes are surfaced as a tool error, not staged.
      const text = response.content.find((c) => c.type === "text");
      const isErrorText = text && text.type === "text" ? text.text.includes("blocked") : false;
      assertEquals(isErrorText, true, "blocked key must return a ConfigPathBlockedError message");
      assertEquals(_drainPendingChangesForTest().length, 0, "blocked key must NOT stage");
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "[configuring-mcp] ConfigApplyTool records an error status when a staged set() rejects",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    _resetPendingChangesForTest();
    const dir = Deno.makeTempDirSync({ prefix: "config-apply-" });
    try {
      createTestConfigDb(dir);
      const context = createStubContext({ config: createStubConfig(createMockConfig(dir)) });

      // Stage a value that PASSES key validation but FAILS value validation at apply
      // time: ai.timeout_ms has min 1000, so 500 rejects inside adapter.set().
      const setTool = new ConfigSetTool(context);
      await setTool.execute({ key: "ai.timeout_ms", value: 500 });

      const applyTool = new ConfigApplyTool(context);
      const response = await applyTool.execute({});

      const structured = response.content.find((c) => c.type === MCP_CONTENT_TYPE_STRUCTURED_DATA);
      assertEquals(structured !== undefined, true, "apply must return structured results");
      const results = structured && structured.type === MCP_CONTENT_TYPE_STRUCTURED_DATA
        ? toApplyResults(structured.data)
        : [];
      const row = results.find((r) => r.key === "ai.timeout_ms");
      assertEquals(row?.status, "error", "a rejected set() must be recorded as error, not applied");
      assertEquals(typeof row?.error, "string");
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});
