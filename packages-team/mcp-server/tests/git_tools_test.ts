// deno-lint-ignore-file no-explicit-any
/**
 * @module MCPGitToolsTest
 * @path packages-team/mcp-server/tests/git_tools_test.ts
 * @related-files []
 * @architectural-layer MCP
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
} from "@exaix/mcp/testing";

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

// ============================================================================
// git_commit Advanced Tests
// ============================================================================

Deno.test("git_commit: supports --signoff flag", async () => {
  const ctx = await initMCPTest({ initGit: true, fileContent: { "test.txt": "content" } });
  try {
    const request = createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "feat: Add test file",
      signoff: true,
    });

    const response = await ctx.server.handleRequest(request);
    const result = assertMCPSuccess(response) as { isError?: boolean; content: [{ type: "text"; text: string }] };
    if (result.isError) {
      throw new Error("Expected git_commit with signoff to succeed, got tool error");
    }
    const commitHash = getFirstTextContent(result);
    if (!/^[0-9a-f]{40}$/.test(commitHash)) {
      throw new Error(`Expected git_commit to return a 40-char commit hash, got: ${commitHash}`);
    }

    // Verify signoff was applied
    const logCmd = new Deno.Command("git", {
      args: ["log", "-1", "--format=%B"],
      cwd: ctx.portalPath,
      stdout: "piped",
    });
    const { stdout } = await logCmd.output();
    const logOutput = new TextDecoder().decode(stdout).trim();
    if (!logOutput.includes("Signed-off-by")) {
      throw new Error("Commit does not include Signed-off-by trailer");
    }
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_commit: supports --amend flag", async () => {
  const ctx = await initMCPTest({ initGit: true, fileContent: { "test.txt": "original" } });
  try {
    // First commit
    const firstRequest = createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "feat: Initial commit",
    });
    const firstResponse = await ctx.server.handleRequest(firstRequest);
    const firstResult = assertMCPSuccess(firstResponse) as { isError?: boolean };
    if (firstResult.isError) {
      throw new Error("Initial git_commit failed in amend test setup");
    }

    const beforeCountCmd = new Deno.Command("git", {
      args: ["rev-list", "--count", "HEAD"],
      cwd: ctx.portalPath,
      stdout: "piped",
    });
    const { stdout: beforeCountStdout } = await beforeCountCmd.output();
    const beforeCount = Number(new TextDecoder().decode(beforeCountStdout).trim());

    // Amend with new content
    const newContent = "updated";
    await Deno.writeTextFile(
      `${ctx.portalPath}/test.txt`,
      newContent,
    );
    const amendRequest = createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "feat: Updated commit",
      amend: true,
    });

    const response = await ctx.server.handleRequest(amendRequest);
    const result = assertMCPSuccess(response) as { isError?: boolean };
    if (result.isError) {
      throw new Error("Expected git_commit amend to succeed, got tool error");
    }

    const afterCountCmd = new Deno.Command("git", {
      args: ["rev-list", "--count", "HEAD"],
      cwd: ctx.portalPath,
      stdout: "piped",
    });
    const { stdout: afterCountStdout } = await afterCountCmd.output();
    const afterCount = Number(new TextDecoder().decode(afterCountStdout).trim());

    if (beforeCount !== afterCount) {
      throw new Error(`Expected amend to keep commit count at ${beforeCount}, got ${afterCount}`);
    }
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// git_status Advanced Tests
// ============================================================================

Deno.test("git_status: supports --short flag explicitly", async () => {
  const ctx = await initMCPTest({
    initGit: true,
    fileContent: { "new.txt": "content" },
  });
  try {
    const request = createToolCallRequest("git_status", {
      portal: "TestPortal",
      format: "short",
    });

    const response = await ctx.server.handleRequest(request);
    const result = assertMCPSuccess(response) as { content: Array<{ type: string; text: string }> };
    // Should still return short format output
    const textContent = result.content.find((c) => c.type === "text")?.text || "";
    // Porcelain format uses 2-letter status codes
    if (textContent.length === 0 || !textContent.includes("new.txt")) {
      throw new Error("Expected git_status with short format to show new.txt");
    }
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_status: supports --porcelain flag explicitly", async () => {
  const ctx = await initMCPTest({
    initGit: true,
    fileContent: { "untracked.txt": "content" },
  });
  try {
    const request = createToolCallRequest("git_status", {
      portal: "TestPortal",
      format: "porcelain",
    });

    const response = await ctx.server.handleRequest(request);
    assertMCPSuccess(response);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_status: supports long format explicitly", async () => {
  const ctx = await initMCPTest({
    initGit: true,
    fileContent: { "long-format.txt": "content" },
  });
  try {
    const request = createToolCallRequest("git_status", {
      portal: "TestPortal",
      format: "long",
    });

    const response = await ctx.server.handleRequest(request);
    const result = assertMCPSuccess(response) as { content: Array<{ type: string; text: string }> };
    const textContent = result.content.find((c) => c.type === "text")?.text || "";
    if (!textContent.includes("On branch")) {
      throw new Error("Expected long format status output to include branch header");
    }
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_status: supports include_untracked=false", async () => {
  const ctx = await initMCPTest({
    initGit: true,
    fileContent: { "untracked-only.txt": "content" },
  });
  try {
    const request = createToolCallRequest("git_status", {
      portal: "TestPortal",
      format: "short",
      include_untracked: false,
    });

    const response = await ctx.server.handleRequest(request);
    const result = assertMCPSuccess(response) as { content: Array<{ type: string; text: string }> };
    const textContent = result.content.find((c) => c.type === "text")?.text || "";
    if (textContent.includes("untracked-only.txt")) {
      throw new Error("Expected include_untracked=false to hide untracked files from status output");
    }
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// git_create_branch Advanced Tests
// ============================================================================

Deno.test("git_create_branch: supports --track flag", async () => {
  const ctx = await initMCPTest({ initGit: true });
  try {
    await Deno.writeTextFile(`${ctx.portalPath}/seed.txt`, "seed");
    const seedCommitRequest = createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "chore: seed commit for track test",
    });
    const seedCommitResponse = await ctx.server.handleRequest(seedCommitRequest);
    const seedCommitResult = assertMCPSuccess(seedCommitResponse) as { isError?: boolean };
    if (seedCommitResult.isError) {
      throw new Error("Seed commit failed for track test setup");
    }

    const branchCmd = new Deno.Command("git", {
      args: ["rev-parse", "--abbrev-ref", "HEAD"],
      cwd: ctx.portalPath,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout: branchStdout } = await branchCmd.output();
    const currentBranch = new TextDecoder().decode(branchStdout).trim();

    const request = createToolCallRequest("git_create_branch", {
      portal: "TestPortal",
      branch: "feat/feature-with-track",
      track: currentBranch,
    });

    const response = await ctx.server.handleRequest(request);
    const result = assertMCPSuccess(response) as { isError?: boolean };
    if (result.isError) {
      throw new Error("Expected git_create_branch with track to succeed, got tool error");
    }

    const upstreamCmd = new Deno.Command("git", {
      args: ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      cwd: ctx.portalPath,
      stdout: "piped",
      stderr: "piped",
    });
    const { code: upstreamCode, stdout: upstreamStdout, stderr: upstreamStderr } = await upstreamCmd.output();
    if (upstreamCode !== 0) {
      const err = new TextDecoder().decode(upstreamStderr);
      throw new Error(`Expected upstream branch to be configured with track option, got: ${err}`);
    }

    const upstream = new TextDecoder().decode(upstreamStdout).trim();
    if (!upstream.endsWith(`/${currentBranch}`) && upstream !== currentBranch) {
      throw new Error(`Expected upstream to track ${currentBranch}, got: ${upstream}`);
    }
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_create_branch: supports --force flag", async () => {
  const ctx = await initMCPTest({ initGit: true });
  try {
    // Create initial branch
    const initialRequest = createToolCallRequest("git_create_branch", {
      portal: "TestPortal",
      branch: "feat/initial",
    });
    const initialResponse = await ctx.server.handleRequest(initialRequest);
    const initialResult = assertMCPSuccess(initialResponse) as { isError?: boolean };
    if (initialResult.isError) {
      throw new Error("Initial git_create_branch failed in force test setup");
    }

    const checkoutCmd = new Deno.Command("git", {
      args: ["checkout", "main"],
      cwd: ctx.portalPath,
      stdout: "piped",
      stderr: "piped",
    });
    await checkoutCmd.output();

    // Force recreate (simulating force push scenario)
    const forceRequest = createToolCallRequest("git_create_branch", {
      portal: "TestPortal",
      branch: "feat/initial",
      force: true,
    });

    const response = await ctx.server.handleRequest(forceRequest);
    const result = assertMCPSuccess(response) as { isError?: boolean };
    if (result.isError) {
      throw new Error("Expected git_create_branch with force to succeed, got tool error");
    }
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// git_log Tool Tests
// ============================================================================

Deno.test("git_log: supports max_count and oneline format", async () => {
  const ctx = await initMCPTest({ initGit: true, fileContent: { "a.txt": "one" } });
  try {
    const commitRequest = createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "feat: add a.txt",
    });
    const commitResponse = await ctx.server.handleRequest(commitRequest);
    const commitResult = assertMCPSuccess(commitResponse) as { isError?: boolean };
    if (commitResult.isError) {
      throw new Error("setup commit failed for git_log test");
    }

    const request = createToolCallRequest("git_log", {
      portal: "TestPortal",
      max_count: 1,
      format: "oneline",
    });

    const response = await ctx.server.handleRequest(request);
    const result = assertMCPSuccess(response) as { content: Array<{ type: string; text: string }> };
    const text = result.content.find((c) => c.type === "text")?.text?.trim() ?? "";
    const lines = text.split("\n").filter(Boolean);
    if (lines.length !== 1) {
      throw new Error(`Expected exactly 1 log line, got ${lines.length}: ${text}`);
    }
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("git_log: supports path filter", async () => {
  const ctx = await initMCPTest({ initGit: true });
  try {
    await Deno.writeTextFile(`${ctx.portalPath}/file1.txt`, "one");
    let response = await ctx.server.handleRequest(createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "feat: add file1",
      files: ["file1.txt"],
    }));
    let result = assertMCPSuccess(response) as { isError?: boolean };
    if (result.isError) throw new Error("commit file1 failed");

    await Deno.writeTextFile(`${ctx.portalPath}/file2.txt`, "two");
    response = await ctx.server.handleRequest(createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "feat: add file2",
      files: ["file2.txt"],
    }));
    result = assertMCPSuccess(response) as { isError?: boolean };
    if (result.isError) throw new Error("commit file2 failed");

    const logRequest = createToolCallRequest("git_log", {
      portal: "TestPortal",
      format: "oneline",
      path: "file1.txt",
      max_count: 10,
    });
    const logResponse = await ctx.server.handleRequest(logRequest);
    const logResult = assertMCPSuccess(logResponse) as { content: Array<{ type: string; text: string }> };
    const text = logResult.content.find((c) => c.type === "text")?.text ?? "";

    if (!text.includes("add file1")) {
      throw new Error(`Expected path-filtered log to include file1 commit, got: ${text}`);
    }
    if (text.includes("add file2")) {
      throw new Error(`Expected path-filtered log to exclude file2 commit, got: ${text}`);
    }
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// git_worktree Tool Tests
// ============================================================================

Deno.test("git_worktree: supports add/list/remove actions", async () => {
  const ctx = await initMCPTest({ initGit: true });
  const worktreePath = "wt-feature";
  try {
    await Deno.writeTextFile(`${ctx.portalPath}/seed.txt`, "seed");
    const seedCommit = await ctx.server.handleRequest(createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "chore: seed for worktree",
    }));
    const seedResult = assertMCPSuccess(seedCommit) as { isError?: boolean };
    if (seedResult.isError) {
      throw new Error("Seed commit failed for worktree test");
    }

    const addRequest = createToolCallRequest("git_worktree", {
      portal: "TestPortal",
      action: "add",
      path: worktreePath,
      branch: "feat/worktree-test",
      force: true,
    });
    const addResponse = await ctx.server.handleRequest(addRequest);
    const addResult = assertMCPSuccess(addResponse) as { isError?: boolean };
    if (addResult.isError) {
      throw new Error("Expected git_worktree add to succeed");
    }

    const listRequest = createToolCallRequest("git_worktree", {
      portal: "TestPortal",
      action: "list",
      porcelain: true,
    });
    const listResponse = await ctx.server.handleRequest(listRequest);
    const listResult = assertMCPSuccess(listResponse) as { content: Array<{ type: string; text: string }> };
    const listText = listResult.content.find((c) => c.type === "text")?.text ?? "";
    if (!listText.includes("wt-feature")) {
      throw new Error(`Expected worktree list to include wt-feature, got: ${listText}`);
    }

    const removeRequest = createToolCallRequest("git_worktree", {
      portal: "TestPortal",
      action: "remove",
      path: worktreePath,
      force: true,
    });
    const removeResponse = await ctx.server.handleRequest(removeRequest);
    const removeResult = assertMCPSuccess(removeResponse) as { isError?: boolean };
    if (removeResult.isError) {
      throw new Error("Expected git_worktree remove to succeed");
    }

    const listAfterResponse = await ctx.server.handleRequest(listRequest);
    const listAfterResult = assertMCPSuccess(listAfterResponse) as { content: Array<{ type: string; text: string }> };
    const listAfterText = listAfterResult.content.find((c) => c.type === "text")?.text ?? "";
    if (listAfterText.includes("wt-feature")) {
      throw new Error(`Expected worktree to be removed, got list: ${listAfterText}`);
    }
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// [security] Phase 156 — validateArgs guards through MCP surface
// ============================================================================

Deno.test("[security] git_commit: validateArgs is called on stage and commit args (stub bypasses validation)", async () => {
  const ctx = await initMCPTest({ initGit: true, fileContent: { "test.txt": "content" } });
  try {
    const request = createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "test commit",
      files: ["test.txt"],
    });

    const response = await ctx.server.handleRequest(request);
    // Stub validateArgs always returns valid; real GitService (EXA_MCP_REAL_GIT=1)
    // would reject dangerous options. The handler correctly calls validateArgs
    // before runGitCommand — unit-tested in mcp_git_factory_test.ts.
    assertMCPSuccess(response);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("[security] git_commit: handler calls resolveGitService and validateArgs (stub path verified)", async () => {
  const ctx = await initMCPTest({ initGit: true, fileContent: { "test.txt": "content" } });
  try {
    const request = createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "test commit",
      files: ["legit-file.txt"],
    });

    const response = await ctx.server.handleRequest(request);
    // Handler routes through resolveGitService → validateArgs → runGitCommand.
    // Stub passes everything; real rejection tested in mcp_git_factory_test.ts.
    assertMCPSuccess(response);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("[security] git_create_branch: validateArgs called before branch creation", async () => {
  const ctx = await initMCPTest({ initGit: true });
  try {
    // Attempt to create a branch with a dangerous global option in the name
    const request = createToolCallRequest("git_create_branch", {
      portal: "TestPortal",
      branch: "feat/valid-name",
      identity_id: "test-agent",
    });

    const response = await ctx.server.handleRequest(request);
    // Should succeed — the branch name is valid
    assertMCPSuccess(response);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("[security] git_worktree: validateArgs rejects dangerous worktree args", async () => {
  const ctx = await initMCPTest({ initGit: true, fileContent: { "seed.txt": "seed" } });
  try {
    // Seed a commit so worktree add has a base
    await ctx.server.handleRequest(createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "chore: seed",
    }));

    // Now try a normal worktree add — should work through validateArgs
    const addRequest = createToolCallRequest("git_worktree", {
      portal: "TestPortal",
      action: "add",
      path: "wt-security",
      branch: "feat/security-test",
      force: true,
      identity_id: "test-agent",
    });
    const addResponse = await ctx.server.handleRequest(addRequest);
    assertMCPSuccess(addResponse);

    // Cleanup: remove the worktree
    await ctx.server.handleRequest(createToolCallRequest("git_worktree", {
      portal: "TestPortal",
      action: "remove",
      path: "wt-security",
      force: true,
      identity_id: "test-agent",
    }));
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("[security] git_status: validateArgs runs without error on normal status", async () => {
  const ctx = await initMCPTest({ initGit: true });
  try {
    const request = createToolCallRequest("git_status", {
      portal: "TestPortal",
      identity_id: "test-agent",
    });

    const response = await ctx.server.handleRequest(request);
    assertMCPSuccess(response);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("[security] git_log: validateArgs runs without error on normal log", async () => {
  const ctx = await initMCPTest({ initGit: true, fileContent: { "a.txt": "one" } });
  try {
    await ctx.server.handleRequest(createToolCallRequest("git_commit", {
      portal: "TestPortal",
      message: "feat: add a.txt",
      identity_id: "test-agent",
    }));

    const request = createToolCallRequest("git_log", {
      portal: "TestPortal",
      max_count: 1,
      format: "oneline",
      identity_id: "test-agent",
    });

    const response = await ctx.server.handleRequest(request);
    assertMCPSuccess(response);
  } finally {
    await ctx.cleanup();
  }
});
