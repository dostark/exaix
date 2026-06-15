/**
 * @module MCPServerResourcesTest
 * @path packages/mcp/tests/server_resources_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Verifies the MCP server's resource discovery logic, ensuring correctly
 * partitioned access to portal files via the 'exa://' URI scheme.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";
import { McpTransportType } from "@exaix/mcp";
import type { PortalOperation } from "@exaix/core";

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { createMockConfig } from "@exaix/testing";
import { initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { MCPServer } from "@exaix-team/mcp-server";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "@exaix/testing";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import type { IApplicationContext } from "@exaix/core/types";

/**
 * Creates a test server with portals
 *
 * When called, this helper uses `initTestDbService()` to create a fresh
 * temporary workspace and database for the test. It returns `{ server, db,
 * tempDir, cleanup }` so callers should call `cleanup()` in their finally
 * block to remove the workspace and close the database.
 */
async function createTestServer(portals: Array<{ alias: string; files: Record<string, string> }>) {
  const { db, tempDir, cleanup } = await initTestDbService();
  const portalConfigs: Array<
    {
      alias: string;
      target_path: string;
      default_branch: string;
      identities_allowed: string[];
      operations: PortalOperation[];
    }
  > = [];

  for (const { alias, files } of portals) {
    const portalPath = join(tempDir, alias);
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = join(portalPath, filePath);
      await ensureDir(join(fullPath, ".."));
      await Deno.writeTextFile(fullPath, content);
    }
    portalConfigs.push({
      alias,
      target_path: portalPath,
      default_branch: TEST_DEFAULT_BRANCH,
      identities_allowed: ["*"],
      operations: [],
    });
  }

  const config = createMockConfig(tempDir, { portals: portalConfigs });
  const context: IApplicationContext = {
    config: createStubConfig(config),
    db,
    git: createStubGit(),
    provider: createStubProvider(),
    display: createStubDisplay(),
  };

  const logger = new EventLogger({ db });
  const server = new MCPServer({
    context,
    transport: McpTransportType.STDIO,
    permissions: new AllowAllPermissionsService(),
    logger,
  });
  await server.start();

  return { server, db, tempDir, cleanup };
}

// ============================================================================
// Resources List Tests
// ============================================================================

Deno.test("MCP Server: handles resources/list request", async () => {
  const { server, cleanup } = await createTestServer([{
    alias: "TestPortal",
    files: { "README.md": "# Test", "src/main.ts": "console.log('test');" },
  }]);

  try {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/list",
      params: {},
    });

    assertExists(response.result);
    const result = response.result as { resources: Array<{ uri: string; name: string }> };

    assertEquals(result.resources.length >= 2, true);
    const hasPortalUri = result.resources.some((r) => r.uri.startsWith("portal://TestPortal/"));
    assertEquals(hasPortalUri, true);

    await server.stop();
  } finally {
    await cleanup();
  }
});

Deno.test("MCP Server: resources/list discovers multiple portals", async () => {
  const { server, cleanup } = await createTestServer([
    { alias: "Portal1", files: { "file1.ts": "// portal1" } },
    { alias: "Portal2", files: { "file2.ts": "// portal2" } },
  ]);

  try {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/list",
      params: {},
    });

    assertExists(response.result);
    const result = response.result as { resources: Array<{ uri: string }> };

    const portal1Resources = result.resources.filter((r) => r.uri.startsWith("portal://Portal1/"));
    const portal2Resources = result.resources.filter((r) => r.uri.startsWith("portal://Portal2/"));

    assertEquals(portal1Resources.length >= 1, true);
    assertEquals(portal2Resources.length >= 1, true);

    await server.stop();
  } finally {
    await cleanup();
  }
});

// ============================================================================
// Resources Read Tests
// ============================================================================

Deno.test("MCP Server: handles resources/read request", async () => {
  const { server, cleanup } = await createTestServer([{
    alias: "TestPortal",
    files: { "test.ts": "export const x = 42;" },
  }]);

  try {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri: "portal://TestPortal/test.ts" },
    });

    assertExists(response.result);
    const result = response.result as { contents: Array<{ type: string; text: string }> };

    assertEquals(result.contents[0].type, "text");
    assertStringIncludes(result.contents[0].text, "export const x = 42");

    await server.stop();
  } finally {
    await cleanup();
  }
});

Deno.test("MCP Server: resources/read rejects invalid URI", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const config = createMockConfig(tempDir);
  const context: IApplicationContext = {
    config: createStubConfig(config),
    db,
    git: createStubGit(),
    provider: createStubProvider(),
    display: createStubDisplay(),
  };
  const logger = new EventLogger({ db });
  const server = new MCPServer({
    context,
    transport: McpTransportType.STDIO,
    permissions: new AllowAllPermissionsService(),
    logger,
  });
  await server.start();

  try {
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri: "http://example.com/file.ts" },
    });

    assertExists(response.error);
    assertEquals(response.error.code, -32602);
    assertStringIncludes(response.error.message, "Invalid portal URI");

    await server.stop();
  } finally {
    await cleanup();
  }
});

Deno.test("MCP Server: resources/read logs to IActivity Journal", async () => {
  const { server, db, cleanup } = await createTestServer([{
    alias: "TestPortal",
    files: { "test.ts": "export {}" },
  }]);

  try {
    await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri: "portal://TestPortal/test.ts" },
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const activities = db.instance.prepare("SELECT * FROM activity WHERE action_type = ?")
      .all("mcp.resources.read");
    assertEquals(activities.length, 1);

    const activity = activities[0] as { target: string };
    assertStringIncludes(activity.target, "portal://TestPortal/test.ts");

    await server.stop();
  } finally {
    await cleanup();
  }
});
