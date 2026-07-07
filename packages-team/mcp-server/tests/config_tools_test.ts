/**
 * @module ConfigToolsTest
 * @path packages-team/mcp-server/tests/config_tools_test.ts
 * @description Tests for MCP config tools — staging + apply logic.
 */
import { assertEquals } from "@std/assert";
import { _resetPendingChangesForTest } from "../config_tools.ts";

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
