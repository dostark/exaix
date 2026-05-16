/**
 * @module ToolHandlerIsErrorTest
 * @path tests/mcp/tool_handler_isError_test.ts
 * @description Verifies that every MCP tool handler returns a structured isError:true response
 * for tool-logic errors instead of throwing a protocol exception. Guards criterion 10 of the
 * Phase 77 success metrics: "0 tool-logic errors thrown as protocol exceptions".
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { PortalOperation, ToolErrorCode } from "@exaix/core";
import { ReadFileTool } from "../../src/mcp/handlers/read_file_tool.ts";
import { DeleteFileTool } from "../../src/mcp/handlers/delete_file_tool.ts";
import { MoveFileTool } from "../../src/mcp/handlers/move_file_tool.ts";
import { PatchFileTool } from "../../src/mcp/handlers/patch_file_tool.ts";
import { ListDirectoryTool } from "../../src/mcp/handlers/list_directory_tool.ts";
import { GitStatusTool } from "../../src/mcp/handlers/git_status_tool.ts";
import { GitCreateBranchTool } from "../../src/mcp/handlers/git_create_branch_tool.ts";
import { createPermissionsService, createToolContext, withToolPermissionTest } from "./helpers/test_setup.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers

function assertIsErrorResponse(response: { isError?: boolean; content: Array<{ type: string; text?: string }> }): void {
  assertEquals(response.isError, true, "Expected isError:true but got isError:false or undefined");
  assert(response.content.length > 0, "Expected non-empty content in error response");
  assertEquals(response.content[0].type, "text", "Expected text content block in error response");
}

// ──────────────────────────────────────────────────────────────────────────────
// ReadFileTool

Deno.test("ReadFileTool: file not found returns isError:true, not thrown exception", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.READ] }, async (env) => {
    const handler = new ReadFileTool(createToolContext(env), createPermissionsService(env));

    const response = await handler.execute({
      portal: "TestPortal",
      path: "nonexistent-file.txt",
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
    assert(
      (response.content[0] as { type: "text"; text: string }).text.toLowerCase().includes("not found"),
      "Error message should mention 'not found'",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DeleteFileTool

Deno.test("DeleteFileTool: file not found returns isError:true, not thrown exception", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const handler = new DeleteFileTool(createToolContext(env), createPermissionsService(env));

    const response = await handler.execute({
      portal: "TestPortal",
      path: "nonexistent.txt",
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
  });
});

Deno.test("DeleteFileTool: directory target returns isError:true, not thrown exception", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const subDir = join(env.portalPath, "subdir");
    await ensureDir(subDir);

    const handler = new DeleteFileTool(createToolContext(env), createPermissionsService(env));

    const response = await handler.execute({
      portal: "TestPortal",
      path: "subdir",
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
    assert(
      (response.content[0] as { type: "text"; text: string }).text.includes("directory"),
      "Error message should mention 'directory'",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// MoveFileTool

Deno.test("MoveFileTool: source not found returns isError:true, not thrown exception", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const handler = new MoveFileTool(createToolContext(env), createPermissionsService(env));

    const response = await handler.execute({
      portal: "TestPortal",
      from: "ghost.txt",
      to: "dest.txt",
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
    assert(
      (response.content[0] as { type: "text"; text: string }).text.toLowerCase().includes("not found"),
      "Error message should mention 'not found'",
    );
  });
});

Deno.test("MoveFileTool: destination already exists returns isError:true, not thrown exception", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.WRITE],
    fileContent: { "src.txt": "source content", "dst.txt": "destination exists" },
  }, async (env) => {
    const handler = new MoveFileTool(createToolContext(env), createPermissionsService(env));

    const response = await handler.execute({
      portal: "TestPortal",
      from: "src.txt",
      to: "dst.txt",
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
    assert(
      (response.content[0] as { type: "text"; text: string }).text.toLowerCase().includes("destination"),
      "Error message should mention 'destination'",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PatchFileTool

Deno.test("PatchFileTool: file not found returns isError:true, not thrown exception", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.WRITE] }, async (env) => {
    const handler = new PatchFileTool(createToolContext(env), createPermissionsService(env));

    const response = await handler.execute({
      portal: "TestPortal",
      path: "ghost.ts",
      search: "old",
      replace: "new",
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
    assert(
      (response.content[0] as { type: "text"; text: string }).text.toLowerCase().includes("not found"),
      "Error message should mention 'not found'",
    );
  });
});

Deno.test("PatchFileTool: search string not found returns isError:true, not thrown exception", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.WRITE],
    fileContent: { "hello.ts": "export const greeting = 'hello';" },
  }, async (env) => {
    const handler = new PatchFileTool(createToolContext(env), createPermissionsService(env));

    const response = await handler.execute({
      portal: "TestPortal",
      path: "hello.ts",
      search: "DOES_NOT_EXIST_IN_FILE",
      replace: "replacement",
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
    assert(
      (response.content[0] as { type: "text"; text: string }).text.includes("not found"),
      "Error message should mention 'not found'",
    );
  });
});

Deno.test("PatchFileTool: ambiguous search returns isError:true, not thrown exception", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.WRITE],
    fileContent: { "dup.ts": "foo foo foo" },
  }, async (env) => {
    const handler = new PatchFileTool(createToolContext(env), createPermissionsService(env));

    const response = await handler.execute({
      portal: "TestPortal",
      path: "dup.ts",
      search: "foo",
      replace: "bar",
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
    assert(
      (response.content[0] as { type: "text"; text: string }).text.includes("times"),
      "Error message should mention occurrence count",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// ListDirectoryTool

Deno.test("ListDirectoryTool: missing subdirectory returns isError:true, not thrown exception", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.READ] }, async (env) => {
    const handler = new ListDirectoryTool(createToolContext(env), createPermissionsService(env));

    const response = await handler.execute({
      portal: "TestPortal",
      path: "does-not-exist/subdir",
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GitStatusTool

Deno.test("GitStatusTool: non-git portal returns isError:true, not thrown exception", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.GIT], initGit: false }, async (env) => {
    const handler = new GitStatusTool(createToolContext(env), createPermissionsService(env));

    const response = await handler.execute({
      portal: "TestPortal",
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
    assert(
      (response.content[0] as { type: "text"; text: string }).text.toLowerCase().includes("git"),
      "Error message should mention 'git'",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GitCreateBranchTool

Deno.test("GitCreateBranchTool: non-git portal returns isError:true, not thrown exception", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.GIT], initGit: false }, async (env) => {
    const handler = new GitCreateBranchTool(createToolContext(env), createPermissionsService(env));

    const response = await handler.execute({
      portal: "TestPortal",
      branch: "feat/test-branch",
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
    assert(
      (response.content[0] as { type: "text"; text: string }).text.toLowerCase().includes("git"),
      "Error message should mention 'git'",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// ToolErrorCode taxonomy contract

Deno.test("ToolErrorCode: all expected error codes are defined", () => {
  assertEquals(ToolErrorCode.NOT_FOUND, "NOT_FOUND");
  assertEquals(ToolErrorCode.INVALID_ARGS, "INVALID_ARGS");
  assertEquals(ToolErrorCode.EXECUTION_FAILED, "EXECUTION_FAILED");
  assertEquals(ToolErrorCode.PERMISSION_DENIED, "PERMISSION_DENIED");
  assertEquals(ToolErrorCode.PATH_TRAVERSAL, "PATH_TRAVERSAL");
});
