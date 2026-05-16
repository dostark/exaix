/**
 * @module MCPPermissionEnforcementTest
 * @path tests/security/mcp_permission_enforcement_test.ts
 * @description Verifies MCP server permission denials are enforced and logged.
 */

import { assertEquals, assertExists } from "@std/assert";
import { McpTransportType } from "@exaix/mcp";
import { PortalOperation } from "@exaix/core";

import { MCPServer } from "../../src/mcp/server.ts";
import { PortalPermissionsService } from "../../src/services/portal/portal_permissions.ts";
import { createMockConfig } from "../helpers/config.ts";
import { initTestDbService } from "../helpers/db.ts";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "../helpers/test_helpers.ts";
import { createToolCallRequest } from "../mcp/helpers/test_setup.ts";

import type { ICliApplicationContext } from "../../src/cli/cli_context.ts";

Deno.test("[security] MCPServer: denies unauthorized portal writes and logs permission denial", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "mcp-security-" });
  const portalPath = `${tempDir}/SecurePortal`;
  await Deno.mkdir(portalPath, { recursive: true });

  const { db, cleanup } = await initTestDbService();

  try {
    const config = createMockConfig(tempDir, {
      portals: [{
        alias: "SecurePortal",
        target_path: portalPath,
        default_branch: "main",
        identities_allowed: ["agent-a"],
        operations: [PortalOperation.READ],
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
      permissions: new PortalPermissionsService(config.portals),
    });

    server.start();

    const response = await server.handleRequest(
      createToolCallRequest("write_file", {
        portal: "SecurePortal",
        path: "blocked.txt",
        content: "nope",
        identity_id: "agent-a",
      }),
    );

    assertExists(response.error);
    assertEquals(response.error?.message, "Permission denied");

    await db.waitForFlush();

    const denialLogs = db.instance.prepare(
      "SELECT * FROM activity WHERE action_type = ?",
    ).all("mcp.permission.denied");

    assertEquals(denialLogs.length, 1);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
