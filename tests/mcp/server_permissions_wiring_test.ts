/**
 * @module MCPServerPermissionsWiringTest
 * @path tests/mcp/server_permissions_wiring_test.ts
 * @description Verifies that live MCP server tool handlers receive explicit portal permissions services.
 */

import { assertEquals, assertExists } from "@std/assert";
import { McpTransportType } from "@exaix/mcp";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";

import { MCPServer } from "@exaix/mcp/server";
import { createMockConfig } from "../helpers/config.ts";
import { initTestDbService } from "../helpers/db.ts";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "../helpers/test_helpers.ts";
import { createToolCallRequest } from "./helpers/test_setup.ts";

import type { ICliApplicationContext } from "../../src/cli/cli_context.ts";

Deno.test("MCPServer: portal-affecting handlers execute when explicit allow-all permissions are provided", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "mcp-server-permissions-" });
  const { db, cleanup } = await initTestDbService();

  try {
    const portalPath = `${tempDir}/TestPortal`;
    await Deno.mkdir(portalPath, { recursive: true });

    const config = createMockConfig(tempDir, {
      portals: [{
        alias: "TestPortal",
        target_path: portalPath,
        default_branch: "main",
        identities_allowed: ["*"],
        operations: [],
      }],
    });

    const context: ICliApplicationContext = {
      config: createStubConfig(config),
      db,
      git: createStubGit(),
      provider: createStubProvider(),
      display: createStubDisplay(),
    };

    const server = new MCPServer({
      context,
      transport: McpTransportType.STDIO,
      permissions: new AllowAllPermissionsService(),
    });

    server.start();

    const response = await server.handleRequest(
      createToolCallRequest("write_file", {
        portal: "TestPortal",
        path: "test.txt",
        content: "ok",
        identity_id: "test-agent",
      }),
    );

    assertExists(response.result);
    assertEquals(response.error, undefined);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
