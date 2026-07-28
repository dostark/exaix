/**
 * @module McpServerContextTest
 * @path apps/mcp-server/tests/server_context_test.ts
 * @related-files [apps/mcp-server/main.ts, packages-team/mcp-server/handlers/search_files_tool.ts]
 * @architectural-layer MCP
 * @description Verifies the standalone MCP server's application context carries a
 *   ToolRegistry. Without it, SearchFilesTool and RunCommandTool throw
 *   "ToolRegistry not available in context", making 2 of the 24 advertised tools
 *   unusable by any external MCP client while `tools/list` still advertises them.
 */

import { assert, assertEquals } from "@std/assert";
import { ConfigService } from "@exaix/core/config";
import { buildServerContext } from "../main.ts";

function writeMinimalConfig(root: string): string {
  const configPath = `${root}/exa.config.toml`;
  Deno.writeTextFileSync(
    configPath,
    [
      "[system]",
      `root = "${root}"`,
      'version = "1.0.0"',
      'log_level = "info"',
      "",
      "[[portals]]",
      'alias = "probe"',
      `target_path = "${root}/portal"`,
      'identities_allowed = ["test-identity"]',
      'operations = ["read", "write"]',
      "",
    ].join("\n"),
  );
  return configPath;
}

Deno.test("buildServerContext: context exposes a ToolRegistry for search_files/run_command", () => {
  const root = Deno.makeTempDirSync({ prefix: "mcp-server-context-" });
  try {
    Deno.mkdirSync(`${root}/portal`, { recursive: true });
    const configService = new ConfigService(writeMinimalConfig(root));
    const { context, dispose } = buildServerContext(configService);
    try {
      assert(context.toolRegistry !== undefined, "context.toolRegistry must be wired");
      assertEquals(typeof context.toolRegistry?.execute, "function");
    } finally {
      dispose();
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("buildServerContext: stub services are present for provider, git and display", () => {
  const root = Deno.makeTempDirSync({ prefix: "mcp-server-context-" });
  try {
    Deno.mkdirSync(`${root}/portal`, { recursive: true });
    const configService = new ConfigService(writeMinimalConfig(root));
    const { context, dispose } = buildServerContext(configService);
    try {
      assertEquals(typeof context.provider.generate, "function");
      assertEquals(typeof context.git.getCurrentBranch, "function");
      assertEquals(typeof context.display.info, "function");
    } finally {
      dispose();
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});
