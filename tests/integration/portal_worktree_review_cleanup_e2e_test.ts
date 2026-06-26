/**
 * @module PortalWorktreeReviewCleanupE2ETest
 * @path tests/integration/portal_worktree_review_cleanup_e2e_test.ts
 * @description Verifies the E2E cleanup logic for portal worktrees, ensuring that temporary
 * branches, pointers, and worktree directories are removed after review (approve/reject).
 */

import { assertEquals, assertExists } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { TestEnvironment } from "./helpers/test_environment.ts";
import {
  createAndRunReviewWorkflow,
  gitOk,
  gitStdout,
  pathExists,
  pathExistsNoFollow,
  runExactl,
  setupWorktreePortalRepo,
  withSingleWorktreePortal,
} from "../helpers/portal_test_utils.ts";

const skipInParallel = !!Deno.env.get("DENO_JOBS") && Deno.env.get("EXA_TEST_FORCE_CLI_PARALLEL") !== "1";

function parallelSafeTest(
  nameOrDef: string | Deno.TestDefinition,
  fn?: () => Promise<void> | void,
): void {
  if (typeof nameOrDef === "string") {
    Deno.test({ name: nameOrDef, ignore: skipInParallel, fn: fn! });
    return;
  }

  Deno.test({
    ...nameOrDef,
    ignore: skipInParallel || !!nameOrDef.ignore,
  });
}

async function ensurePortalSymlink(portalsDir: string, alias: string, targetPath: string): Promise<void> {
  await ensureDir(portalsDir);
  const linkPath = join(portalsDir, alias);
  try {
    await Deno.symlink(targetPath, linkPath);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) return;
    throw error;
  }
}

async function getReviewWorktreePaths(env: TestEnvironment, traceId: string, portalTargetPath: string) {
  const reviewRow = await env.db.preparedGet<
    { branch: string; repository: string; worktree_path: string | null }
  >(
    "SELECT branch, repository, worktree_path FROM reviews WHERE trace_id = ?",
    [traceId],
  );

  assertExists(reviewRow);
  assertExists(reviewRow.worktree_path);
  assertEquals(reviewRow.repository, portalTargetPath);

  const canonicalWorktreePath = reviewRow.worktree_path;
  const pointerPath = join(env.tempDir, "Memory", "Execution", traceId, "worktree");

  assertEquals(await pathExists(canonicalWorktreePath), true);
  assertEquals(await pathExistsNoFollow(pointerPath), true);
  assertEquals(await gitOk(portalTargetPath, ["rev-parse", "--verify", reviewRow.branch]), true);

  return { reviewBranch: reviewRow.branch, canonicalWorktreePath, pointerPath };
}

async function setupReviewWorktreeScenario() {
  const env = await TestEnvironment.create();

  const portalAlias = "worktree-portal";
  const portalTargetPath = join(env.tempDir, "portal-worktree-target");
  const targetBranch = "release_1.2";

  await setupWorktreePortalRepo(portalTargetPath, targetBranch);

  const config = withSingleWorktreePortal(env.config, portalAlias, portalTargetPath, "main");
  await ensurePortalSymlink(join(env.tempDir, "Portals"), portalAlias, portalTargetPath);

  const { traceId, result } = await createAndRunReviewWorkflow(env, config, {
    portalAlias,
    targetBranch,
    description: "Worktree review cleanup check",
    writePath: "src/worktree_hello.ts",
    writeContent: `export const hello = ${JSON.stringify("hello-worktree")};\n`,
  });

  assertEquals(result.success, true);
  assertEquals(result.traceId, traceId);

  const { reviewBranch, canonicalWorktreePath, pointerPath } = await getReviewWorktreePaths(
    env,
    traceId,
    portalTargetPath,
  );

  return {
    env,
    portalTargetPath,
    targetBranch,
    traceId,
    reviewBranch,
    canonicalWorktreePath,
    pointerPath,
  };
}

async function assertReviewCleanup(params: {
  portalTargetPath: string;
  reviewBranch: string;
  canonicalWorktreePath: string;
  pointerPath: string;
}) {
  const { portalTargetPath, reviewBranch, canonicalWorktreePath, pointerPath } = params;

  // Feature branch should be deleted.
  assertEquals(await gitOk(portalTargetPath, ["rev-parse", "--verify", reviewBranch]), false);

  await assertWorktreeAndPointerRemoved({ portalTargetPath, canonicalWorktreePath, pointerPath });
}

async function assertWorktreeAndPointerRemoved(params: {
  portalTargetPath: string;
  canonicalWorktreePath: string;
  pointerPath: string;
}) {
  const { portalTargetPath, canonicalWorktreePath, pointerPath } = params;

  // Worktree should be removed from git and filesystem.
  const wtList = await gitStdout(portalTargetPath, ["worktree", "list", "--porcelain"]);
  assertEquals(wtList.includes(canonicalWorktreePath), false);
  assertEquals(await pathExists(canonicalWorktreePath), false);

  // Pointer should be removed to avoid dangling discoverability.
  assertEquals(await pathExistsNoFollow(pointerPath), false);
}

parallelSafeTest(
  "[e2e][regression] review reject removes worktree, pointer, and feature branch",
  async () => {
    const scenario = await setupReviewWorktreeScenario();
    const env = scenario.env;

    try {
      const {
        canonicalWorktreePath,
        pointerPath,
        portalTargetPath,
        reviewBranch,
      } = scenario;

      const reject = await runExactl([
        "review",
        "reject",
        reviewBranch,
        "--reason",
        "not needed",
      ], env.tempDir);
      assertEquals(reject.code, 0, reject.stderr);

      await assertReviewCleanup({
        portalTargetPath,
        reviewBranch,
        canonicalWorktreePath,
        pointerPath,
      });

      // Portal checkout should remain on main and not contain the file.
      assertEquals(await gitStdout(portalTargetPath, ["branch", "--show-current"]), "main");
      assertEquals(await pathExists(join(portalTargetPath, "src", "worktree_hello.ts")), false);
    } finally {
      await env.cleanup();
    }
  },
);

parallelSafeTest(
  "[e2e][regression] review approve removes worktree, pointer, and feature branch",
  async () => {
    const scenario = await setupReviewWorktreeScenario();
    const env = scenario.env;

    try {
      const {
        canonicalWorktreePath,
        pointerPath,
        portalTargetPath,
        reviewBranch,
        targetBranch,
      } = scenario;

      // Approve requires being on the base branch.
      await gitStdout(portalTargetPath, ["checkout", targetBranch]);

      const approve = await runExactl(["review", "approve", reviewBranch], env.tempDir);
      assertEquals(approve.code, 0, approve.stderr);

      await assertReviewCleanup({
        portalTargetPath,
        reviewBranch,
        canonicalWorktreePath,
        pointerPath,
      });

      // Merged change should be present on the target branch.
      assertEquals(await gitStdout(portalTargetPath, ["branch", "--show-current"]), targetBranch);
      assertEquals(await pathExists(join(portalTargetPath, "src", "worktree_hello.ts")), true);
    } finally {
      await env.cleanup();
    }
  },
);

parallelSafeTest(
  "[e2e][negative] review approve merge conflict aborts merge and cleans worktree",
  async () => {
    const env = await TestEnvironment.create();

    try {
      const portalAlias = "worktree-portal";
      const portalTargetPath = join(env.tempDir, "portal-worktree-target");
      const targetBranch = "release_1.2";

      await setupWorktreePortalRepo(portalTargetPath, targetBranch);

      // Seed a file that will later conflict.
      await gitStdout(portalTargetPath, ["checkout", targetBranch]);
      await Deno.writeTextFile(
        join(portalTargetPath, "src", "conflict.ts"),
        `export const conflict = ${JSON.stringify("base")};\n`,
      );
      await gitStdout(portalTargetPath, ["add", "src/conflict.ts"]);
      await gitStdout(portalTargetPath, ["commit", "-m", "Seed conflict file on base"]);

      // Simulate user checkout staying on main.
      await gitStdout(portalTargetPath, ["checkout", "main"]);

      const config = withSingleWorktreePortal(env.config, portalAlias, portalTargetPath, "main");

      await ensurePortalSymlink(join(env.tempDir, "Portals"), portalAlias, portalTargetPath);

      const { traceId, result } = await createAndRunReviewWorkflow(env, config, {
        portalAlias,
        targetBranch,
        description: "Review merge conflict cleanup check",
        writePath: "src/conflict.ts",
        writeContent: `export const conflict = ${JSON.stringify("feature")};\n`,
      });

      assertEquals(result.success, true);
      assertEquals(result.traceId, traceId);

      const { reviewBranch, canonicalWorktreePath, pointerPath } = await getReviewWorktreePaths(
        env,
        traceId,
        portalTargetPath,
      );

      // Create a conflicting commit on the base branch after the feature branch exists.
      await gitStdout(portalTargetPath, ["checkout", targetBranch]);
      await Deno.writeTextFile(
        join(portalTargetPath, "src", "conflict.ts"),
        `export const conflict = ${JSON.stringify("base-changed")};\n`,
      );
      await gitStdout(portalTargetPath, ["add", "src/conflict.ts"]);
      await gitStdout(portalTargetPath, ["commit", "-m", "Change conflict file on base"]);

      const approve = await runExactl(["review", "approve", reviewBranch], env.tempDir);
      assertEquals(approve.code === 0, false, "Expected approve to fail due to merge conflict");

      // Repo should not be left in a conflicted merge state (merge --abort should run).
      assertEquals(
        await gitOk(portalTargetPath, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]),
        false,
      );
      const unmerged = await gitStdout(portalTargetPath, ["diff", "--name-only", "--diff-filter=U"]);
      assertEquals(unmerged.trim(), "");

      // Worktree checkout + pointer should still be cleaned up (no orphaned worktrees).
      await assertWorktreeAndPointerRemoved({
        portalTargetPath,
        canonicalWorktreePath,
        pointerPath,
      });

      // Feature branch should remain for manual conflict resolution.
      assertEquals(await gitOk(portalTargetPath, ["rev-parse", "--verify", reviewBranch]), true);
      assertEquals(await gitStdout(portalTargetPath, ["branch", "--show-current"]), targetBranch);
    } finally {
      await env.cleanup();
    }
  },
);
