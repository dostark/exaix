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
import { stub } from "@std/testing/mock";
import { PortalOperation, ToolErrorCode } from "@exaix/core";
import { ReadFileTool } from "@exaix/mcp/server";
import { DeleteFileTool } from "@exaix/mcp/server";
import { MoveFileTool } from "@exaix/mcp/server";
import { PatchFileTool } from "@exaix/mcp/server";
import { ListDirectoryTool } from "@exaix/mcp/server";
import { GitStatusTool } from "@exaix/mcp/server";
import { GitCreateBranchTool } from "@exaix/mcp/server";
import { GitCommitTool } from "@exaix/mcp/server";
import { ApprovePlanTool, CreateRequestTool, ListPlansTool, QueryJournalTool } from "@exaix/mcp/server";
import { PlanCommands } from "../../src/cli/commands/plan_commands.ts";
import { RequestCommands } from "../../src/cli/commands/request_commands.ts";
import { createStubContext, createStubDb } from "../helpers/test_helpers.ts";
import {
  createBaseToolContext,
  createPermissionsService,
  createToolContext,
  withToolPermissionTest,
} from "./helpers/test_setup.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers

function assertIsErrorResponse(response: { isError?: boolean; content: Array<{ type: string; text?: string }> }): void {
  assertEquals(response.isError, true, "Expected isError:true but got isError:false or undefined");
  assert(response.content.length > 0, "Expected non-empty content in error response");
  assertEquals(response.content[0].type, "text", "Expected text content block in error response");
}

function assertErrorTextIncludes(
  response: { content: Array<{ type: string; text?: string }> },
  fragment: string,
  message: string,
): void {
  assert(
    (response.content[0] as { type: "text"; text: string }).text.toLowerCase().includes(fragment.toLowerCase()),
    message,
  );
}

async function expectProtectedToolError(
  options: {
    operations: PortalOperation[];
    fileContent?: Record<string, string>;
    initGit?: boolean;
  },
  execute: (
    env: Parameters<typeof withToolPermissionTest>[1] extends (env: infer T) => Promise<void> ? T : never,
  ) => Promise<{
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  }>,
  expectedText?: { fragment: string; message: string },
): Promise<void> {
  await withToolPermissionTest(options, async (env) => {
    const response = await execute(env);

    assertIsErrorResponse(response);
    if (expectedText) {
      assertErrorTextIncludes(response, expectedText.fragment, expectedText.message);
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// ReadFileTool

Deno.test("ReadFileTool: file not found returns isError:true, not thrown exception", async () => {
  await expectProtectedToolError(
    { operations: [PortalOperation.READ] },
    (env) =>
      new ReadFileTool(createToolContext(env), createPermissionsService(env)).execute({
        portal: "TestPortal",
        path: "nonexistent-file.txt",
        identity_id: "test-agent",
      }),
    { fragment: "not found", message: "Error message should mention 'not found'" },
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// DeleteFileTool

Deno.test("DeleteFileTool: file not found returns isError:true, not thrown exception", async () => {
  await expectProtectedToolError(
    { operations: [PortalOperation.WRITE] },
    (env) =>
      new DeleteFileTool(createToolContext(env), createPermissionsService(env)).execute({
        portal: "TestPortal",
        path: "nonexistent.txt",
        identity_id: "test-agent",
      }),
  );
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
  await expectProtectedToolError(
    { operations: [PortalOperation.WRITE] },
    (env) =>
      new MoveFileTool(createToolContext(env), createPermissionsService(env)).execute({
        portal: "TestPortal",
        from: "ghost.txt",
        to: "dest.txt",
        identity_id: "test-agent",
      }),
    { fragment: "not found", message: "Error message should mention 'not found'" },
  );
});

Deno.test("MoveFileTool: destination already exists returns isError:true, not thrown exception", async () => {
  await expectProtectedToolError(
    {
      operations: [PortalOperation.WRITE],
      fileContent: { "src.txt": "source content", "dst.txt": "destination exists" },
    },
    (env) =>
      new MoveFileTool(createToolContext(env), createPermissionsService(env)).execute({
        portal: "TestPortal",
        from: "src.txt",
        to: "dst.txt",
        identity_id: "test-agent",
      }),
    { fragment: "destination", message: "Error message should mention 'destination'" },
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// PatchFileTool

Deno.test("PatchFileTool: file not found returns isError:true, not thrown exception", async () => {
  await expectProtectedToolError(
    { operations: [PortalOperation.WRITE] },
    (env) =>
      new PatchFileTool(createToolContext(env), createPermissionsService(env)).execute({
        portal: "TestPortal",
        path: "ghost.ts",
        search: "old",
        replace: "new",
        identity_id: "test-agent",
      }),
    { fragment: "not found", message: "Error message should mention 'not found'" },
  );
});

Deno.test("PatchFileTool: search string not found returns isError:true, not thrown exception", async () => {
  await expectProtectedToolError(
    {
      operations: [PortalOperation.WRITE],
      fileContent: { "hello.ts": "export const greeting = 'hello';" },
    },
    (env) =>
      new PatchFileTool(createToolContext(env), createPermissionsService(env)).execute({
        portal: "TestPortal",
        path: "hello.ts",
        search: "DOES_NOT_EXIST_IN_FILE",
        replace: "replacement",
        identity_id: "test-agent",
      }),
    { fragment: "not found", message: "Error message should mention 'not found'" },
  );
});

Deno.test("PatchFileTool: ambiguous search returns isError:true, not thrown exception", async () => {
  await expectProtectedToolError(
    {
      operations: [PortalOperation.WRITE],
      fileContent: { "dup.ts": "foo foo foo" },
    },
    (env) =>
      new PatchFileTool(createToolContext(env), createPermissionsService(env)).execute({
        portal: "TestPortal",
        path: "dup.ts",
        search: "foo",
        replace: "bar",
        identity_id: "test-agent",
      }),
    { fragment: "times", message: "Error message should mention occurrence count" },
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// ListDirectoryTool

Deno.test("ListDirectoryTool: missing subdirectory returns isError:true, not thrown exception", async () => {
  await expectProtectedToolError(
    { operations: [PortalOperation.READ] },
    (env) =>
      new ListDirectoryTool(createToolContext(env), createPermissionsService(env)).execute({
        portal: "TestPortal",
        path: "does-not-exist/subdir",
        identity_id: "test-agent",
      }),
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// GitStatusTool

Deno.test("GitStatusTool: non-git portal returns isError:true, not thrown exception", async () => {
  await expectProtectedToolError(
    { operations: [PortalOperation.GIT], initGit: false },
    (env) =>
      new GitStatusTool(createToolContext(env), createPermissionsService(env)).execute({
        portal: "TestPortal",
        identity_id: "test-agent",
      }),
    { fragment: "git", message: "Error message should mention 'git'" },
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// GitCreateBranchTool

Deno.test("GitCreateBranchTool: non-git portal returns isError:true, not thrown exception", async () => {
  await expectProtectedToolError(
    { operations: [PortalOperation.GIT], initGit: false },
    (env) =>
      new GitCreateBranchTool(createToolContext(env), createPermissionsService(env)).execute({
        portal: "TestPortal",
        branch: "feat/test-branch",
        identity_id: "test-agent",
      }),
    { fragment: "git", message: "Error message should mention 'git'" },
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// GitCommitTool

Deno.test("GitCommitTool: commit failure returns isError:true, not thrown exception", async () => {
  await expectProtectedToolError(
    { operations: [PortalOperation.GIT], initGit: true },
    (env) =>
      new GitCommitTool(createToolContext(env), createPermissionsService(env)).execute({
        portal: "TestPortal",
        message: "test commit",
        identity_id: "test-agent",
      }),
    { fragment: "commit", message: "Error message should mention 'commit'" },
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Domain tools

Deno.test("CreateRequestTool: command failure returns isError:true, not thrown exception", async () => {
  const requestStub = stub(
    RequestCommands.prototype,
    "create",
    () => Promise.reject(new Error("Request creation failed")),
  );

  try {
    const handler = new CreateRequestTool(createBaseToolContext());
    const response = await handler.execute({
      description: "broken request",
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
  } finally {
    requestStub.restore();
  }
});

Deno.test("ListPlansTool: command failure returns isError:true, not thrown exception", async () => {
  const planListStub = stub(
    PlanCommands.prototype,
    "list",
    () => Promise.reject(new Error("Plan listing failed")),
  );

  try {
    const handler = new ListPlansTool(createBaseToolContext());
    const response = await handler.execute({
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
  } finally {
    planListStub.restore();
  }
});

Deno.test("ApprovePlanTool: command failure returns isError:true, not thrown exception", async () => {
  const planApproveStub = stub(
    PlanCommands.prototype,
    "approve",
    () => Promise.reject(new Error("Plan approval failed")),
  );

  try {
    const handler = new ApprovePlanTool(createBaseToolContext());
    const response = await handler.execute({
      plan_id: "missing-plan",
      identity_id: "test-agent",
    });

    assertIsErrorResponse(response);
  } finally {
    planApproveStub.restore();
  }
});

Deno.test("QueryJournalTool: database failure returns isError:true, not thrown exception", async () => {
  const handler = new QueryJournalTool(
    createStubContext({
      db: createStubDb({
        getRecentActivity: () => Promise.reject(new Error("Journal unavailable")),
      }),
    }),
  );

  const response = await handler.execute({
    identity_id: "test-agent",
  });

  assertIsErrorResponse(response);
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
