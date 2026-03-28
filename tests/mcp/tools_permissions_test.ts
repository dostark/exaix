/**
 * @module MCPToolsPermissionsTest
 * @path tests/mcp/tools_permissions_test.ts
 * @description Verifies the capability-based security model for MCP tools, ensuring strict
 * enforcement of read/write permissions at the tool level before execution.
 */

import { assertExists, assertRejects } from "@std/assert";
import { PortalOperation } from "../../src/shared/enums.ts";

import { GitStatusTool } from "../../src/mcp/handlers/git_status_tool.ts";
import { ReadFileTool } from "../../src/mcp/handlers/read_file_tool.ts";
import { WriteFileTool } from "../../src/mcp/handlers/write_file_tool.ts";
import { PortalPermissionsService } from "../../src/services/portal_permissions.ts";
import { initToolPermissionTest } from "./helpers/test_setup.ts";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "../helpers/test_helpers.ts";
import type { ICliApplicationContext } from "../../src/cli/cli_context.ts";

// ============================================================================
// Read Operation Permission Tests
// ============================================================================

// Helper for tool permission tests
async function withToolPermission(
  options: {
    operations?: PortalOperation[];
    fileContent?: Record<string, string>;
    initGit?: boolean;
    identityId?: string;
  },
  fn: (ctx: { context: ICliApplicationContext; permissions: PortalPermissionsService }) => Promise<void>,
) {
  const ctx = await initToolPermissionTest(options);
  try {
    const permissions = new PortalPermissionsService([ctx.permissions]);
    const context: ICliApplicationContext = {
      config: createStubConfig(ctx.config),
      db: ctx.db,
      git: createStubGit(),
      provider: createStubProvider(),
      display: createStubDisplay(),
    };
    await fn({ context, permissions });
  } finally {
    await ctx.cleanup();
  }
}

// ============================================================================
// Read Operation Permission Tests
// ============================================================================

Deno.test("MCP Tools: read_file requires read permission", async () => {
  await withToolPermission(
    {
      operations: [PortalOperation.READ],
      fileContent: { "test.txt": "content" },
    },
    async ({ context, permissions }) => {
      const tool = new ReadFileTool(context, permissions);

      const result = await tool.execute({
        portal: "TestPortal",
        path: "test.txt",
        identity_id: "test-agent",
      });

      assertExists(result.content);
    },
  );
});

Deno.test("MCP Tools: read_file rejects when read permission denied", async () => {
  await withToolPermission(
    {
      operations: [PortalOperation.WRITE], // No read permission
      fileContent: { "test.txt": "content" },
    },
    async ({ context, permissions }) => {
      const tool = new ReadFileTool(context, permissions);

      await assertRejects(
        async () => {
          await tool.execute({
            portal: "TestPortal",
            path: "test.txt",
            identity_id: "test-agent",
          });
        },
        Error,
        "not permitted",
      );
    },
  );
});

// ============================================================================
// Write Operation Permission Tests
// ============================================================================

Deno.test("MCP Tools: write_file requires write permission", async () => {
  await withToolPermission(
    {
      operations: [PortalOperation.READ, PortalOperation.WRITE],
    },
    async ({ context, permissions }) => {
      const tool = new WriteFileTool(context, permissions);

      const result = await tool.execute({
        portal: "TestPortal",
        path: "test.txt",
        content: "new content",
        identity_id: "test-agent",
      });

      assertExists(result.content);
    },
  );
});

Deno.test("MCP Tools: write_file rejects when write permission denied", async () => {
  await withToolPermission(
    {
      operations: [PortalOperation.READ], // No write permission
    },
    async ({ context, permissions }) => {
      const tool = new WriteFileTool(context, permissions);

      await assertRejects(
        async () => {
          await tool.execute({
            portal: "TestPortal",
            path: "test.txt",
            content: "new content",
            identity_id: "test-agent",
          });
        },
        Error,
        "not permitted",
      );
    },
  );
});

// ============================================================================
// Git Operation Permission Tests
// ============================================================================

Deno.test("MCP Tools: git_status requires git permission", async () => {
  await withToolPermission(
    {
      operations: [PortalOperation.READ, PortalOperation.GIT],
      initGit: true,
    },
    async ({ context, permissions }) => {
      const tool = new GitStatusTool(context, permissions);

      const result = await tool.execute({
        portal: "TestPortal",
        identity_id: "test-agent",
      });

      assertExists(result.content);
    },
  );
});

Deno.test("MCP Tools: git_status rejects when git permission denied", async () => {
  await withToolPermission(
    {
      operations: [PortalOperation.READ, PortalOperation.WRITE], // No git permission
    },
    async ({ context, permissions }) => {
      const tool = new GitStatusTool(context, permissions);

      await assertRejects(
        async () => {
          await tool.execute({
            portal: "TestPortal",
            identity_id: "test-agent",
          });
        },
        Error,
        "not permitted",
      );
    },
  );
});

// ============================================================================
// Agent Whitelist Tests
// ============================================================================

Deno.test("MCP Tools: rejects non-whitelisted agent", async () => {
  await withToolPermission(
    {
      identityId: "allowed-agent",
      operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
      fileContent: { "test.txt": "content" },
    },
    async ({ context, permissions }) => {
      const tool = new ReadFileTool(context, permissions);

      await assertRejects(
        async () => {
          await tool.execute({
            portal: "TestPortal",
            path: "test.txt",
            identity_id: "unauthorized-agent",
          });
        },
        Error,
        "not allowed",
      );
    },
  );
});

Deno.test("MCP Tools: allows wildcard agent access", async () => {
  await withToolPermission(
    {
      identityId: "*",
      operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
      fileContent: { "test.txt": "content" },
    },
    async ({ context, permissions }) => {
      const tool = new ReadFileTool(context, permissions);

      const result = await tool.execute({
        portal: "TestPortal",
        path: "test.txt",
        identity_id: "any-agent",
      });

      assertExists(result.content);
    },
  );
});
