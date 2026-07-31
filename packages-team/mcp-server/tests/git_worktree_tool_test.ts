/**
 * @module GitWorktreeToolTest
 * @path packages-team/mcp-server/tests/git_worktree_tool_test.ts
 * @description Worktree lifecycle through the tool that implements it: add a detached worktree
 *   pinned to an exact SHA, confirm the pin and the detached HEAD, remove it, and confirm a
 *   failing action returns `isError:true` rather than throwing.
 *
 *   These assertions previously lived in `tests/scenario_framework/tests/unit/pinned_worktree_step_test.ts`,
 *   which asserted them against raw `git` subprocesses and imported nothing from Exaix — it
 *   verified that git's own `worktree add --detach` works. Its third case, "cleanup runs even when
 *   mid-scenario step failed", wrote its own `try/finally` and then asserted the `finally` block
 *   had run, which is a property of JavaScript, not of this codebase. Meanwhile `GitWorktreeTool`
 *   — the only production code in the repo that passes `--detach` — had no test at all.
 * @architectural-layer MCP
 * @related-files [packages-team/mcp-server/handlers/git_worktree_tool.ts, packages/mcp/server/tool_handler.ts]
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { GitWorktreeAction, PortalOperation } from "@exaix/core";
import { GitWorktreeTool } from "@exaix-team/mcp-server";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { createPermissionsService, createToolContext, withToolPermissionTest } from "@exaix/mcp/testing";

const IDENTITY = "test-agent";
const PORTAL = "TestPortal";
const WORKTREE_DIR = "wt";

async function git(args: string[], cwd: string): Promise<{ code: number; stdout: string }> {
  const { code, stdout } = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" })
    .output();
  return { code, stdout: new TextDecoder().decode(stdout).trim() };
}

/**
 * Commits the seeded file and puts the resulting commit on a branch, returning both.
 *
 * The pin is exercised through a BRANCH ref rather than a raw SHA on purpose. `git worktree add
 * <path> <sha>` detaches on its own whenever the ref is a commit, so a SHA-based test passes
 * identically whether or not the tool forwards `--detach` — it re-asserts a git default instead of
 * this handler's flag handling. A branch ref makes the flag load-bearing: with `--detach` the
 * checkout is detached at the branch tip, without it the checkout is attached to the branch.
 */
async function seedCommit(portalPath: string): Promise<{ sha: string; branch: string }> {
  const branch = "pinned-base";
  await git(["add", "-A"], portalPath);
  await git(["commit", "-q", "-m", "init"], portalPath);
  await git(["branch", branch], portalPath);
  const { stdout } = await git(["rev-parse", "HEAD"], portalPath);
  return { sha: stdout, branch };
}

function toolText(response: MCPToolResponse): string {
  const block = response.content[0];
  return block && block.type === "text" ? block.text : "";
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

function worktreeTool(env: Parameters<typeof createToolContext>[0]): GitWorktreeTool {
  return new GitWorktreeTool(createToolContext(env), createPermissionsService(env));
}

Deno.test("[git-worktree] detach pins the worktree to the branch tip in detached HEAD", async () => {
  await withToolPermissionTest(
    { operations: [PortalOperation.GIT], initGit: true, fileContent: { "hello.txt": "hello" } },
    async (env) => {
      const { sha, branch } = await seedCommit(env.portalPath);

      const response = await worktreeTool(env).execute({
        portal: PORTAL,
        action: GitWorktreeAction.ADD,
        path: WORKTREE_DIR,
        ref: branch,
        detach: true,
        identity_id: IDENTITY,
      });

      assert(!response.isError, `worktree add must succeed, got: ${toolText(response)}`);

      const worktreePath = join(env.portalPath, WORKTREE_DIR);
      const { stdout: headSha } = await git(["rev-parse", "HEAD"], worktreePath);
      assertEquals(headSha, sha, "worktree HEAD must sit on the pinned commit");

      const { stdout: symbolicRef } = await git(["symbolic-ref", "-q", "HEAD"], worktreePath);
      assertEquals(symbolicRef, "", "a pinned worktree must be in detached HEAD state");
    },
  );
});

Deno.test("[git-worktree] omitting detach leaves the worktree attached to the branch", async () => {
  // The negative half of the pin, and what makes the pair sensitive to the flag rather than to
  // git's defaults: the same ref without `detach:true` must produce an ATTACHED checkout.
  await withToolPermissionTest(
    { operations: [PortalOperation.GIT], initGit: true, fileContent: { "hello.txt": "hello" } },
    async (env) => {
      const { branch } = await seedCommit(env.portalPath);

      const response = await worktreeTool(env).execute({
        portal: PORTAL,
        action: GitWorktreeAction.ADD,
        path: WORKTREE_DIR,
        ref: branch,
        identity_id: IDENTITY,
      });

      assert(!response.isError, `worktree add must succeed, got: ${toolText(response)}`);

      const { stdout: symbolicRef } = await git(
        ["symbolic-ref", "-q", "HEAD"],
        join(env.portalPath, WORKTREE_DIR),
      );
      assertEquals(symbolicRef, `refs/heads/${branch}`, "without detach the checkout tracks the branch");
    },
  );
});

Deno.test("[git-worktree] remove deletes the worktree directory", async () => {
  await withToolPermissionTest(
    { operations: [PortalOperation.GIT], initGit: true, fileContent: { "hello.txt": "hello" } },
    async (env) => {
      const { sha } = await seedCommit(env.portalPath);
      const tool = worktreeTool(env);
      const worktreePath = join(env.portalPath, WORKTREE_DIR);

      await tool.execute({
        portal: PORTAL,
        action: GitWorktreeAction.ADD,
        path: WORKTREE_DIR,
        ref: sha,
        detach: true,
        identity_id: IDENTITY,
      });
      assert(await exists(worktreePath), "worktree must exist before removal");

      const response = await tool.execute({
        portal: PORTAL,
        action: GitWorktreeAction.REMOVE,
        path: WORKTREE_DIR,
        identity_id: IDENTITY,
      });

      assert(!response.isError, `worktree remove must succeed, got: ${toolText(response)}`);
      assertEquals(await exists(worktreePath), false, "worktree directory must be gone after remove");
    },
  );
});

Deno.test("[git-worktree] list reports the worktree the tool created", async () => {
  await withToolPermissionTest(
    { operations: [PortalOperation.GIT], initGit: true, fileContent: { "hello.txt": "hello" } },
    async (env) => {
      const { sha } = await seedCommit(env.portalPath);
      const tool = worktreeTool(env);

      await tool.execute({
        portal: PORTAL,
        action: GitWorktreeAction.ADD,
        path: WORKTREE_DIR,
        ref: sha,
        detach: true,
        identity_id: IDENTITY,
      });

      const response = await tool.execute({
        portal: PORTAL,
        action: GitWorktreeAction.LIST,
        porcelain: true,
        identity_id: IDENTITY,
      });

      assert(!response.isError, `worktree list must succeed, got: ${toolText(response)}`);
      assertStringIncludes(toolText(response), WORKTREE_DIR);
    },
  );
});

Deno.test("[git-worktree] removing a worktree that was never added returns isError, not a throw", async () => {
  // Replaces the deleted "cleanup runs even when mid-scenario step failed" case, which asserted
  // that its own `finally` block executed. The behaviour worth pinning is the tool's contract:
  // tool-logic failures come back as isError:true instead of escaping as protocol exceptions.
  await withToolPermissionTest(
    { operations: [PortalOperation.GIT], initGit: true, fileContent: { "hello.txt": "hello" } },
    async (env) => {
      await seedCommit(env.portalPath);

      const response = await worktreeTool(env).execute({
        portal: PORTAL,
        action: GitWorktreeAction.REMOVE,
        path: "never-created",
        identity_id: IDENTITY,
      });

      assertEquals(response.isError, true);
      assertStringIncludes(toolText(response).toLowerCase(), "working tree");
    },
  );
});

Deno.test("[git-worktree] a portal without the GIT operation is refused", async () => {
  await withToolPermissionTest(
    { operations: [PortalOperation.READ], initGit: true, fileContent: { "hello.txt": "hello" } },
    async (env) => {
      await seedCommit(env.portalPath);

      const response = await worktreeTool(env).execute({
        portal: PORTAL,
        action: GitWorktreeAction.LIST,
        identity_id: IDENTITY,
      });

      assertEquals(response.isError, true);
      assertStringIncludes(toolText(response).toLowerCase(), "not permitted");
    },
  );
});

Deno.test("[git-worktree][security] a traversing worktree path is rejected before git runs", async () => {
  await withToolPermissionTest(
    { operations: [PortalOperation.GIT], initGit: true, fileContent: { "hello.txt": "hello" } },
    async (env) => {
      const { sha } = await seedCommit(env.portalPath);

      const response = await worktreeTool(env).execute({
        portal: PORTAL,
        action: GitWorktreeAction.ADD,
        path: "../escaped-worktree",
        ref: sha,
        detach: true,
        identity_id: IDENTITY,
      });

      assertEquals(response.isError, true);
      assertEquals(
        await exists(join(env.tempDir, "escaped-worktree")),
        false,
        "a rejected path must not have created anything outside the portal",
      );
    },
  );
});
