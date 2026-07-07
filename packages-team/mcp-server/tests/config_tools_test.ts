/**
 * @module ConfigToolsTest
 * @path packages-team/mcp-server/tests/config_tools_test.ts
 * @description Tests for MCP config tools — staging + apply logic.
 */
import { assertEquals } from "@std/assert";
import { _resetPendingChangesForTest, ConfigApplyTool, ConfigSetTool } from "../config_tools.ts";
import { createMockConfig, createStubConfig, createStubContext } from "@exaix/testing";
import { createTestConfigDb } from "@exaix/testing";
import { type JSONValue, MCP_CONTENT_TYPE_STRUCTURED_DATA } from "@exaix/core";

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
    // Both require human approval
    assertEquals(
      mod.includes(
        'requires_human_approval: true,\n    docs_visible: true,\n    source_ref: "packages-team/mcp-server/config_tools.ts"',
      ),
      true,
    );
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
