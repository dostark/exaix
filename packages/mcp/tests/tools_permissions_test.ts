/**
 * @module MCPToolsPermissionsTest
 * @path packages/mcp/tests/tools_permissions_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Verifies the capability-based security model for MCP tools, ensuring strict
 * enforcement of read/write permissions at the tool level before execution.
 */

import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { PortalOperation } from "@exaix/core";

import { GitStatusTool } from "@exaix-team/mcp-server";
import { ReadFileTool } from "@exaix-team/mcp-server";
import { WriteFileTool } from "@exaix-team/mcp-server";
import { PortalPermissionsService } from "@exaix/portal";
import { initToolPermissionTest } from "@exaix/mcp/testing";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "@exaix/testing";
import type { IApplicationContext } from "@exaix/core/types";

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
  fn: (ctx: { context: IApplicationContext; permissions: PortalPermissionsService }) => Promise<void>,
) {
  const ctx = await initToolPermissionTest(options);
  try {
    const permissions = new PortalPermissionsService([ctx.permissions]);
    const context: IApplicationContext = {
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
      const result = await tool.execute({
        portal: "TestPortal",
        path: "test.txt",
        identity_id: "test-agent",
      });
      assertEquals(result.isError, true);
      assertStringIncludes((result.content[0] as { type: string; text: string }).text, "not permitted");
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
      const result = await tool.execute({
        portal: "TestPortal",
        identity_id: "test-agent",
      });
      assertEquals(result.isError, true);
      assertStringIncludes((result.content[0] as { type: string; text: string }).text, "not permitted");
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
      const result = await tool.execute({
        portal: "TestPortal",
        path: "test.txt",
        identity_id: "unauthorized-agent",
      });
      assertEquals(result.isError, true);
      assertStringIncludes((result.content[0] as { type: string; text: string }).text, "not allowed");
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

Deno.test("MCP Tools: permission-protected handlers fail closed without permissions service", async () => {
  await withToolPermission(
    {
      operations: [PortalOperation.READ],
      fileContent: { "test.txt": "content" },
    },
    async ({ context }) => {
      const tool = new ReadFileTool(context);
      const result = await tool.execute({
        portal: "TestPortal",
        path: "test.txt",
        identity_id: "test-agent",
      });
      assertEquals(result.isError, true);
      assertStringIncludes((result.content[0] as { type: string; text: string }).text, "Permission denied");
    },
  );
});
