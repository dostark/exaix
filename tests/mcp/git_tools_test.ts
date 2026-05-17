// deno-lint-ignore-file no-explicit-any
/**
 * @module MCPGitToolsTest
 * @path tests/mcp/git_tools_test.ts
 * @description Verifies Git-operation tools exposed via MCP, ensuring stable
 * branch creation and repository state management within portal boundaries.
 */

import {
  assertMCPContentIncludes,
  assertMCPError,
  assertMCPSuccess,
  assertMCPToolError,
  createToolCallRequest,
  getFirstTextContent,
  initMCPTest,
  initMCPTestWithoutPortal,
} from "./helpers/test_setup.ts";

interface IMCPResponseShape<TResult = any> {
  error?: { code: number; message: string };
  result?: TResult;
}

/**
 * Tests for Git Tool Implementations
 *
 * Success Criteria:
 * - git_create_branch creates feature branches with validation
 * - git_commit commits changes with proper message validation
 * - git_status queries repository status
 * - All tools validate portal and git repository existence
 * - All tools log to IActivity Journal
 */

// ============================================================================
// git_create_branch Tool Tests
// ============================================================================

Deno.test("git_create_branch: successfully creates feature branch", async () => {
  const ctx = await initMCPTest({ initGit: true });
  try {
    const request = createToolCallRequest("git_create_branch", {
      portal: "TestPortal",
      branch: "feat/new-feature",
    });

    const response = await ctx.server.handleRequest(request);
    assertMCPSuccess(response);
    assertMCPContentIncludes(
      response as IMCPResponseShape<{ content: Array<{ type: string; text: string }> }>,
      "feat/new-feature",
    );
    assertMCPContentIncludes(
      response as IMCPResponseShape<{ content: Array<{ type: string; text: string }> }>,
      "created",
    );
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_create_branch: validates branch name format", async () => {
  const ctx = await initMCPTest({ initGit: true });
  try {
    const request = createToolCallRequest("git_create_branch", {
      portal: "TestPortal",
      branch: "invalid-branch-name",
    });

    const response = await ctx.server.handleRequest(request);
    assertMCPError(response, -32602);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_create_branch: rejects non-existent portal", async () => {
  const ctx = await initMCPTestWithoutPortal();
  try {
    const request = createToolCallRequest("git_create_branch", {
      portal: "NonExistent",
      branch: "feat/test",
    });

    const response = await ctx.server.handleRequest(request);
    assertMCPToolError(response as IMCPResponseShape, "not found");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_create_branch: rejects non-git repository", async () => {
  const ctx = await initMCPTest(); // No git init
  try {
    const request = createToolCallRequest("git_create_branch", {
      portal: "TestPortal",
      branch: "feat/test",
    });

    const response = await ctx.server.handleRequest(request);
    assertMCPToolError(response as IMCPResponseShape);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// git_commit Tool Tests
// ============================================================================

Deno.test("git_commit: successfully commits changes", async () => {
  const ctx = await initMCPTest({
    initGit: true,
    fileContent: { "test.txt": "content" },
  });
  try {
    const request = createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "feat: Add test file",
    });

    const response = await ctx.server.handleRequest(request);
    const result = assertMCPSuccess(response) as { content: [{ type: "text"; text: string }] };
    const commitHash = getFirstTextContent(result);
    if (!/^[0-9a-f]{40}$/.test(commitHash)) {
      throw new Error(`Expected git_commit to return a 40-char commit hash, got: ${commitHash}`);
    }
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_commit: commits specific files when provided", async () => {
  const ctx = await initMCPTest({
    initGit: true,
    fileContent: {
      "file1.txt": "content1",
      "file2.txt": "content2",
    },
  });
  try {
    const request = createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "feat: Add file1 only",
      files: ["file1.txt"],
    });

    const response = await ctx.server.handleRequest(request);
    assertMCPSuccess(response);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_commit: rejects empty commit message", async () => {
  const ctx = await initMCPTest({ initGit: true });
  try {
    const request = createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "",
    });

    const response = await ctx.server.handleRequest(request);
    assertMCPError(response, -32602);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_commit: rejects when nothing to commit", async () => {
  const ctx = await initMCPTest({ initGit: true });
  try {
    const request = createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "test commit",
    });

    const response = await ctx.server.handleRequest(request);
    assertMCPToolError(response as IMCPResponseShape, "Failed to commit");
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// git_status Tool Tests
// ============================================================================

Deno.test("git_status: shows clean repository status", async () => {
  const ctx = await initMCPTest({ initGit: true });
  try {
    const request = createToolCallRequest("git_status", {
      portal: "TestPortal",
    });

    const response = await ctx.server.handleRequest(request);
    assertMCPSuccess(response);
    assertMCPContentIncludes(
      response as IMCPResponseShape<{ content: Array<{ type: string; text: string }> }>,
      "clean",
    );
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_status: shows uncommitted changes", async () => {
  const ctx = await initMCPTest({
    initGit: true,
    fileContent: { "new-file.txt": "content" },
  });
  try {
    const request = createToolCallRequest("git_status", {
      portal: "TestPortal",
    });

    const response = await ctx.server.handleRequest(request);
    assertMCPSuccess(response);
    assertMCPContentIncludes(
      response as IMCPResponseShape<{ content: Array<{ type: string; text: string }> }>,
      "new-file.txt",
    );
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_status: rejects non-git repository", async () => {
  const ctx = await initMCPTest(); // No git init
  try {
    const request = createToolCallRequest("git_status", {
      portal: "TestPortal",
    });

    const response = await ctx.server.handleRequest(request);
    assertMCPToolError(response as IMCPResponseShape);
  } finally {
    await ctx.cleanup();
  }
});
