/**
 * @module PortalWorkflowE2ETest
 * @path tests/integration/24_portal_e2e_workflow_test.ts
 * @description Comprehensive E2E test for the Portal-driven workflow, covering both read-only
 * artifact reviews and write-capable Git reviews within external portal repositories.
 */

import { assert, assertEquals, assertExists, assertMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";

import { PortalExecutionStrategy, PortalOperation } from "@exaix/core";
import { ReviewStatus } from "@exaix/core/status/review_status.ts";
import { TestEnvironment } from "./helpers/test_environment.ts";
import {
  approveReviewStatus,
  assertFileInBranch,
  assertPointerPointsTo,
  assertPortalBranchExists,
  assertReviewBaseBranch,
  assertReviewStatus,
  createAndRunReviewWorkflow,
  executePlanForReview,
  gitStdout,
  listBranches,
  pathExists,
  runExactl,
} from "../helpers/portal_test_utils.ts";
import type { setupGitRepo as _setupGitRepo } from "../helpers/git_test_helper.ts";
import { TEST_DEFAULT_BRANCH } from "../helpers/constants.ts";
import { readFixtureTextSync } from "../helpers/fixtures.ts";

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

interface IPortalWorkflowTestContext {
  env: TestEnvironment;
  portalConfig: Awaited<ReturnType<TestEnvironment["setupPortal"]>>["config"];
  portalTargetPath: string;
  config: TestEnvironment["config"];
}

interface IPortalWorkflowTestOptions {
  alias: string;
  targetDirName: string;
  operations?: PortalOperation[];
  ensureSrcDir?: boolean;
  executionStrategy?: PortalExecutionStrategy;
}

interface IPortalWriteWorkflowOptions {
  portalAlias: string;
  targetBranch?: string;
  description: string;
  writePath: string;
  writeContent: string;
}

interface IReleaseBranchPortalWorkflowResult {
  createdPortalBranch: string;
  result: { success: boolean; traceId: string | undefined; error?: string };
  targetBranch: string;
  targetHeadBeforeExecution: string;
  traceId: string;
}

const HELLO_FILE_PATH = "src/hello.ts";
const HELLO_FILE_CONTENT = `export function hello(): string {\n  return "Hello from portal";\n}\n`;
const RELEASE_TARGET_BRANCH = "release_1.2";
const RELEASE_ONLY_FILE_PATH = "src/release_only.ts";

async function runPortalWriteWorkflow(
  env: TestEnvironment,
  config: TestEnvironment["config"],
  portalTargetPath: string,
  options: IPortalWriteWorkflowOptions,
) {
  const { traceId, requestId, result, reviewRegistry } = await createAndRunReviewWorkflow(
    env,
    config,
    {
      portalAlias: options.portalAlias,
      ...(options.targetBranch ? { targetBranch: options.targetBranch } : {}),
      description: options.description,
      writePath: options.writePath,
      writeContent: options.writeContent,
    },
  );

  const createdPortalBranch = await assertPortalBranchExists(portalTargetPath, `feat/${requestId}-`);

  return { traceId, requestId, result, reviewRegistry, createdPortalBranch };
}

async function seedReleaseBranch(portalTargetPath: string, targetBranch: string): Promise<string> {
  await gitStdout(portalTargetPath, ["branch", targetBranch, TEST_DEFAULT_BRANCH]);
  await gitStdout(portalTargetPath, ["checkout", targetBranch]);
  await Deno.writeTextFile(
    join(portalTargetPath, "src", "release_base.ts"),
    `export const base = ${JSON.stringify(targetBranch)};\n`,
  );
  await gitStdout(portalTargetPath, ["add", "."]);
  await gitStdout(portalTargetPath, ["commit", "-m", "Release base commit"]);
  const targetHeadBeforeExecution = await gitStdout(portalTargetPath, ["rev-parse", "HEAD"]);
  await gitStdout(portalTargetPath, ["checkout", TEST_DEFAULT_BRANCH]);
  return targetHeadBeforeExecution;
}

async function runReleaseBranchPortalWorkflow(
  context: IPortalWorkflowTestContext,
  options?: { targetBranch?: string },
): Promise<IReleaseBranchPortalWorkflowResult> {
  const targetBranch = options?.targetBranch ?? RELEASE_TARGET_BRANCH;
  const targetHeadBeforeExecution = await seedReleaseBranch(context.portalTargetPath, targetBranch);
  const { traceId, result, createdPortalBranch } = await runPortalWriteWorkflow(
    context.env,
    context.config,
    context.portalTargetPath,
    {
      portalAlias: context.portalConfig.alias,
      targetBranch,
      description: "Add a release-only file in the portal repo",
      writePath: RELEASE_ONLY_FILE_PATH,
      writeContent: `export const releaseOnly = ${JSON.stringify(targetBranch)};\n`,
    },
  );

  return {
    createdPortalBranch,
    result,
    targetBranch,
    targetHeadBeforeExecution,
    traceId,
  };
}

async function assertPortalFileExistsInBranch(
  portalTargetPath: string,
  branch: string,
  path: string,
  expectedContent: string,
): Promise<void> {
  const fileContent = await gitStdout(portalTargetPath, ["show", `${branch}:${path}`]);
  assertStringIncludes(fileContent, expectedContent);
}

async function assertPortalFileMissingInBranch(
  portalTargetPath: string,
  branch: string,
  path: string,
): Promise<void> {
  const fileOutput = await new Deno.Command(PortalOperation.GIT, {
    args: ["show", `${branch}:${path}`],
    cwd: portalTargetPath,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(fileOutput.success, false);
}

async function withPortalWorkflowContext(
  options: IPortalWorkflowTestOptions,
  run: (context: IPortalWorkflowTestContext) => Promise<void>,
): Promise<void> {
  const env = await TestEnvironment.create();

  try {
    const { config: portalConfig, portalDir: portalTargetPath } = await env.setupPortal({
      alias: options.alias,
      targetPath: join(env.tempDir, options.targetDirName),
      operations: options.operations ?? [],
    });

    if (options.ensureSrcDir !== false) {
      await ensureDir(join(portalTargetPath, "src"));
    }

    const config = {
      ...env.config,
      portals: [
        options.executionStrategy ? { ...portalConfig, execution_strategy: options.executionStrategy } : portalConfig,
      ],
    };

    await run({ env, portalConfig, portalTargetPath, config });
  } finally {
    await env.cleanup();
  }
}

async function enablePortalDiscovery(tempDir: string, portalAlias: string, portalTargetPath: string): Promise<void> {
  const portalsDir = join(tempDir, "Portals");
  await ensureDir(portalsDir);
  const portalSymlinkPath = join(portalsDir, portalAlias);
  try {
    await Deno.symlink(portalTargetPath, portalSymlinkPath);
  } catch {
    // Continue.
  }
}

async function preparePortalCliApproval(
  tempDir: string,
  portalAlias: string,
  portalTargetPath: string,
  targetBranch: string,
): Promise<void> {
  await enablePortalDiscovery(tempDir, portalAlias, portalTargetPath);
  await gitStdout(portalTargetPath, ["checkout", targetBranch]);
}

parallelSafeTest("[e2e] Portal request → plan → execution → artifact review (read-only)", async () => {
  const env = await TestEnvironment.create();

  try {
    const { config: portalConfig, portalDir: portalTargetPath } = await env.setupPortal({
      alias: "test-portal",
      targetPath: join(env.tempDir, "portal-target"),
      operations: [],
    });

    // IBlueprint as Blueprint must include capabilities so ExecutionLoop can detect read-only mode.
    const blueprintsDir = join(env.tempDir, "Blueprints", "Identities");
    await ensureDir(blueprintsDir);
    const fixture_1 = readFixtureTextSync(
      import.meta.url,
      "integration",
      "24_portal_e2e_workflow_test",
      "fixture_1.md",
    );
    await Deno.writeTextFile(join(blueprintsDir, "code-analyst.md"), fixture_1);

    const config = {
      ...env.config,
      portals: [portalConfig],
    };

    const { processor } = env.createRequestProcessor();

    const { filePath: requestPath, traceId } = await env.createRequest(
      "Analyze the portal repo and summarize what you find",
      { identityId: "code-analyst", portal: portalConfig.alias },
    );

    const requestId = requestPath.split("/").pop()!.replace(/\.md$/, "");

    const planPath = await processor.process(requestPath);
    assertExists(planPath, "RequestProcessor should generate a plan");

    const planContent = await Deno.readTextFile(planPath);
    assertStringIncludes(planContent, `trace_id: ${traceId}`);
    assertStringIncludes(planContent, `request_id: ${requestId}`);
    assertStringIncludes(planContent, `identity_id: code-analyst`);
    assertStringIncludes(planContent, `portal: ${portalConfig.alias}`);

    const activePlanPath = await env.approvePlan(planPath);
    const portalBranchesBefore = await listBranches(portalTargetPath);
    const workspaceBranchesBefore = await env.getGitBranches();
    const result = await executePlanForReview(env, config, activePlanPath);

    assertEquals(result.success, true);
    assertEquals(result.traceId, traceId);

    // Trace artifacts should exist for inspection (supporting evidence).
    const tracePlanPath = join(env.tempDir, "Memory", "Execution", traceId, "plan.md");
    const traceSummaryPath = join(env.tempDir, "Memory", "Execution", traceId, "summary.md");
    const tracePlanExists = await Deno.stat(tracePlanPath).then(() => true).catch(() => false);
    const traceSummaryExists = await Deno.stat(traceSummaryPath).then(() => true).catch(() => false);
    assertEquals(tracePlanExists, true, "Expected Memory/Execution/<traceId>/plan.md");
    assertEquals(traceSummaryExists, true, "Expected Memory/Execution/<traceId>/summary.md");

    const artifacts = await env.db.preparedAll<
      { id: string; status: string; identity: string; portal: string | null; request_id: string; file_path: string }
    >(
      "SELECT id, status, identity, portal, request_id, file_path FROM artifacts WHERE request_id = ?",
      [requestId],
    );

    assertEquals(artifacts.length, 1, "Exactly one artifact should be created");
    assertExists(artifacts[0].id);
    assertEquals(artifacts[0].status, ReviewStatus.PENDING);
    assertEquals(artifacts[0].identity, "code-analyst");
    assertEquals(artifacts[0].portal, portalConfig.alias);

    const artifactAbsPath = join(env.tempDir, artifacts[0].file_path);
    const artifactFileExists = await Deno.stat(artifactAbsPath).then(() => true).catch(() => false);
    assertEquals(artifactFileExists, true, "Expected canonical artifact markdown file to exist");
    const artifactFileContentBefore = await Deno.readTextFile(artifactAbsPath);
    assertStringIncludes(artifactFileContentBefore, `status: ${ReviewStatus.PENDING}`);
    assertStringIncludes(artifactFileContentBefore, `request_id: ${requestId}`);
    assertStringIncludes(artifactFileContentBefore, `portal: ${portalConfig.alias}`);
    assertStringIncludes(
      artifactFileContentBefore,
      `Memory/Execution/${traceId}/`,
      "Artifact body should reference the trace directory",
    );

    // Ensure read-only execution didn't mutate either repository.
    const portalBranchesAfter = await listBranches(portalTargetPath);
    assertEquals([...portalBranchesAfter].sort(), [...portalBranchesBefore].sort());

    const workspaceBranchesAfter = await env.getGitBranches();
    assertEquals([...workspaceBranchesAfter].sort(), [...workspaceBranchesBefore].sort());

    // Validate unified CLI review surface works for portal artifacts.
    const show = await runExactl(["review", "show", artifacts[0].id, "--diff"], env.tempDir);
    assertEquals(show.code, 0);
    assertStringIncludes(show.stdout, "Execution Artifact");
    assertStringIncludes(show.stdout, requestId);
    assertStringIncludes(show.stdout, traceId);

    const approve = await runExactl(["review", "approve", artifacts[0].id], env.tempDir);
    assertEquals(approve.code, 0);

    const updated = await env.db.preparedGet<{ status: string }>(
      "SELECT status FROM artifacts WHERE id = ?",
      [artifacts[0].id],
    );
    assertExists(updated);
    assertEquals(updated.status, ReviewStatus.APPROVED);

    const artifactFileContentAfter = await Deno.readTextFile(artifactAbsPath);
    assertStringIncludes(artifactFileContentAfter, `status: ${ReviewStatus.APPROVED}`);
  } finally {
    await env.cleanup();
  }
});

parallelSafeTest("[e2e] Portal request → execution → git review in portal repo (write-capable)", async () => {
  await withPortalWorkflowContext({ alias: "write-portal", targetDirName: "portal-write-target" }, async ({
    env,
    portalConfig,
    portalTargetPath,
    config,
  }) => {
    const _portalBranchesBefore = await listBranches(portalTargetPath);
    const workspaceBranchesBefore = await env.getGitBranches();

    const { traceId, result, reviewRegistry, createdPortalBranch } = await runPortalWriteWorkflow(
      env,
      config,
      portalTargetPath,
      {
        portalAlias: portalConfig.alias,
        description: "Add a hello file in the portal repo",
        writePath: HELLO_FILE_PATH,
        writeContent: HELLO_FILE_CONTENT,
      },
    );

    assertEquals(result.success, true);
    assertEquals(result.traceId, traceId);

    const workspaceBranchesAfter = await env.getGitBranches();
    assertEquals(
      workspaceBranchesAfter,
      workspaceBranchesBefore,
      "Workspace repo should not receive new branches for portal execution",
    );

    // Review should be registered with the portal repository as `repository`.
    const reviews = await reviewRegistry.list({ trace_id: traceId });
    assertEquals(reviews.length, 1);
    assertEquals(reviews[0].portal, portalConfig.alias);
    assertEquals(reviews[0].repository, portalTargetPath);

    const diff = await reviewRegistry.getDiff(reviews[0].id);
    assertStringIncludes(diff, "src/hello.ts");

    // Verify review can be retrieved by branch name
    const reviewByBranch = await reviewRegistry.getByBranch(createdPortalBranch);
    assertExists(reviewByBranch, "Review should be retrievable by branch name");
    assertEquals(reviewByBranch.branch, createdPortalBranch);

    // Approve review using service layer (not CLI)
    await approveReviewStatus(reviewRegistry, reviews[0].id);

    // Verify status was updated
    await assertReviewStatus(env.db, traceId, ReviewStatus.APPROVED);

    // Verify file was created in the feature branch
    await assertFileInBranch(portalTargetPath, createdPortalBranch, HELLO_FILE_PATH, "Hello from portal");
  });
});

parallelSafeTest("[e2e] Portal target_branch review approve merges into that branch", async () => {
  await withPortalWorkflowContext({ alias: "write-portal", targetDirName: "portal-write-target" }, async ({
    env,
    portalConfig,
    portalTargetPath,
    config,
  }) => {
    const {
      createdPortalBranch,
      result,
      targetBranch,
      targetHeadBeforeExecution,
      traceId,
    } = await runReleaseBranchPortalWorkflow({ env, portalConfig, portalTargetPath, config });

    assertEquals(result.success, true);
    assertEquals(result.traceId, traceId);

    // Step 37.5 regression: feature branch should be created from targetBranch.
    const mergeBase = await gitStdout(portalTargetPath, ["merge-base", createdPortalBranch, targetBranch]);
    assertEquals(
      mergeBase,
      targetHeadBeforeExecution,
      "Expected feature branch to be based on target branch HEAD",
    );

    // Verify base_branch stored in reviews table for this branch.
    const stored = await env.db.preparedGet<{ base_branch: string | null }>(
      "SELECT base_branch FROM reviews WHERE branch = ?",
      [createdPortalBranch],
    );
    assertExists(stored);
    assertEquals(stored.base_branch, targetBranch);

    await preparePortalCliApproval(env.tempDir, portalConfig.alias, portalTargetPath, targetBranch);

    const approve = await runExactl(["review", "approve", createdPortalBranch], env.tempDir);
    assertEquals(approve.code, 0, approve.stderr);

    // After merge: file should exist on the target branch but not on main.
    await assertPortalFileExistsInBranch(portalTargetPath, targetBranch, RELEASE_ONLY_FILE_PATH, targetBranch);
    await assertPortalFileMissingInBranch(portalTargetPath, "main", RELEASE_ONLY_FILE_PATH);
  });
});

parallelSafeTest("[e2e][negative] Portal CLI review approve fails if not on review base_branch", async () => {
  await withPortalWorkflowContext({ alias: "write-portal", targetDirName: "portal-write-target" }, async ({
    env,
    portalConfig,
    portalTargetPath,
    config,
  }) => {
    const { createdPortalBranch, result, targetBranch } = await runReleaseBranchPortalWorkflow({
      env,
      portalConfig,
      portalTargetPath,
      config,
    });

    assertEquals(result.success, true);

    await enablePortalDiscovery(env.tempDir, portalConfig.alias, portalTargetPath);

    // Stay on main (wrong base) and ensure the guard triggers.
    await gitStdout(portalTargetPath, ["checkout", TEST_DEFAULT_BRANCH]);

    const cliApprove = await runExactl(["review", "approve", createdPortalBranch], env.tempDir);
    assert(cliApprove.code !== 0, "Expected review approve to fail off the review base_branch");
    assertStringIncludes(cliApprove.stdout, `Must be on '${targetBranch}' branch`);
    assertStringIncludes(cliApprove.stdout, `Run: git checkout ${targetBranch}`);
  });
});

parallelSafeTest("[e2e][negative] Portal CLI review show fails without portal symlink", async () => {
  await withPortalWorkflowContext({ alias: "write-portal", targetDirName: "portal-write-target" }, async ({
    env,
    portalConfig,
    portalTargetPath,
    config,
  }) => {
    const { traceId, result, createdPortalBranch } = await runPortalWriteWorkflow(env, config, portalTargetPath, {
      portalAlias: portalConfig.alias,
      description: "Add a hello file in the portal repo",
      writePath: HELLO_FILE_PATH,
      writeContent: HELLO_FILE_CONTENT,
    });

    assertEquals(result.success, true);
    assertEquals(result.traceId, traceId);

    // NOTE: no `Portals/<alias>` symlink created on purpose.
    const cliShow = await runExactl(["review", "show", createdPortalBranch, "--diff"], env.tempDir);
    assert(cliShow.code !== 0, "Expected review show to fail without portal discovery symlink");
    assertStringIncludes(cliShow.stdout, "Branch not found");
  });
});

parallelSafeTest(
  "[e2e] Portal target_branch + worktree strategy executes in worktree and review approve merges into that branch",
  async () => {
    await withPortalWorkflowContext({
      alias: "write-portal",
      targetDirName: "portal-write-target",
      executionStrategy: PortalExecutionStrategy.WORKTREE,
    }, async ({ env, portalConfig, portalTargetPath, config }) => {
      // Simulate user checkout staying on main.
      await gitStdout(portalTargetPath, ["checkout", TEST_DEFAULT_BRANCH]);
      assertEquals(await gitStdout(portalTargetPath, ["branch", "--show-current"]), TEST_DEFAULT_BRANCH);

      const {
        createdPortalBranch,
        result,
        targetBranch,
        targetHeadBeforeExecution,
        traceId,
      } = await runReleaseBranchPortalWorkflow({ env, portalConfig, portalTargetPath, config });

      assertEquals(result.success, true);
      assertEquals(result.traceId, traceId);

      // Portal checkout should remain untouched.
      assertEquals(await gitStdout(portalTargetPath, ["branch", "--show-current"]), TEST_DEFAULT_BRANCH);
      assertMatch(createdPortalBranch, /^feat\/request-[0-9a-f]{8}-/);

      // Feature branch should be based on targetBranch HEAD.
      const mergeBase = await gitStdout(portalTargetPath, ["merge-base", createdPortalBranch, targetBranch]);
      assertEquals(mergeBase, targetHeadBeforeExecution);

      // Review should record worktree_path.
      const reviewRow = await env.db.preparedGet<{ worktree_path: string | null; base_branch: string | null }>(
        "SELECT worktree_path, base_branch FROM reviews WHERE branch = ?",
        [createdPortalBranch],
      );
      assertExists(reviewRow);
      assertEquals(reviewRow.base_branch, targetBranch);
      assertExists(reviewRow.worktree_path);

      const canonicalWorktreePath = reviewRow.worktree_path;
      assertEquals(await pathExists(canonicalWorktreePath), true);
      await assertPointerPointsTo(env.tempDir, traceId, canonicalWorktreePath);

      await preparePortalCliApproval(env.tempDir, portalConfig.alias, portalTargetPath, targetBranch);

      const approve = await runExactl(["review", "approve", createdPortalBranch], env.tempDir);
      assertEquals(approve.code, 0, approve.stderr);

      // Worktree + pointer should be cleaned up, and feature branch deleted.
      const wtList = await gitStdout(portalTargetPath, ["worktree", "list", "--porcelain"]);
      assertEquals(wtList.includes(canonicalWorktreePath), false);
      assertEquals(await pathExists(canonicalWorktreePath), false);
      assertEquals(await pathExists(join(env.tempDir, "Memory", "Execution", traceId, "worktree")), false);
      const branchesNow = await listBranches(portalTargetPath);
      assertEquals(branchesNow.includes(createdPortalBranch), false);

      // Merge should land on the target branch only.
      await assertPortalFileExistsInBranch(portalTargetPath, targetBranch, RELEASE_ONLY_FILE_PATH, targetBranch);
      await assertPortalFileMissingInBranch(portalTargetPath, "main", RELEASE_ONLY_FILE_PATH);
    });
  },
);

parallelSafeTest("[e2e] Portal review stores base_branch for CLI validation", async () => {
  await withPortalWorkflowContext({ alias: "write-portal", targetDirName: "portal-write-target" }, async ({
    env,
    portalConfig,
    portalTargetPath,
    config,
  }) => {
    const { traceId, result, reviewRegistry, createdPortalBranch } = await runPortalWriteWorkflow(
      env,
      config,
      portalTargetPath,
      {
        portalAlias: portalConfig.alias,
        description: "Add a hello file in the portal repo",
        writePath: HELLO_FILE_PATH,
        writeContent: HELLO_FILE_CONTENT,
      },
    );

    assertEquals(result.success, true);

    // Verify review was registered with correct base_branch
    await assertReviewBaseBranch(env.db, traceId, TEST_DEFAULT_BRANCH);

    // Verify review can be retrieved by branch
    const reviewByBranch = await reviewRegistry.getByBranch(createdPortalBranch);
    assertExists(reviewByBranch);
    assertEquals(reviewByBranch.base_branch, TEST_DEFAULT_BRANCH);
  });
});

parallelSafeTest("[e2e] Portal review detects divergent branches", async () => {
  await withPortalWorkflowContext({ alias: "write-portal", targetDirName: "portal-write-target" }, async ({
    env,
    portalConfig,
    portalTargetPath,
    config,
  }) => {
    // Seed a base file on main
    await Deno.writeTextFile(
      join(portalTargetPath, "src", "hello.ts"),
      `export function hello(): string {\n  return "Base";\n}\n`,
    );
    await new Deno.Command(PortalOperation.GIT, {
      args: ["add", "src/hello.ts"],
      cwd: portalTargetPath,
      stdout: "piped",
      stderr: "piped",
    }).output();
    await new Deno.Command(PortalOperation.GIT, {
      args: ["commit", "-m", "Seed hello.ts"],
      cwd: portalTargetPath,
      stdout: "piped",
      stderr: "piped",
    }).output();

    const { traceId, requestId, result, reviewRegistry } = await createAndRunReviewWorkflow(env, config, {
      portalAlias: portalConfig.alias,
      description: "Change hello.ts in the portal repo",
      writePath: "src/hello.ts",
      writeContent: `export function hello(): string {\n  return "Feature";\n}\n`,
    });

    assertEquals(result.success, true);

    const createdPortalBranch = await assertPortalBranchExists(portalTargetPath, `feat/${requestId}-`);

    // Diverge main after the feature branch was created
    await new Deno.Command(PortalOperation.GIT, {
      args: ["checkout", TEST_DEFAULT_BRANCH],
      cwd: portalTargetPath,
      stdout: "piped",
      stderr: "piped",
    }).output();

    await Deno.writeTextFile(
      join(portalTargetPath, "src", "hello.ts"),
      `export function hello(): string {\n  return "Main";\n}\n`,
    );
    await new Deno.Command(PortalOperation.GIT, {
      args: ["add", "src/hello.ts"],
      cwd: portalTargetPath,
      stdout: "piped",
      stderr: "piped",
    }).output();
    await new Deno.Command(PortalOperation.GIT, {
      args: ["commit", "-m", "Conflicting change on main"],
      cwd: portalTargetPath,
      stdout: "piped",
      stderr: "piped",
    }).output();

    // Verify branches have diverged (different commits)
    const featureCommitCmd = new Deno.Command(PortalOperation.GIT, {
      args: ["rev-parse", createdPortalBranch],
      cwd: portalTargetPath,
      stdout: "piped",
      stderr: "piped",
    });
    const mainCommitCmd = new Deno.Command(PortalOperation.GIT, {
      args: ["rev-parse", TEST_DEFAULT_BRANCH],
      cwd: portalTargetPath,
      stdout: "piped",
      stderr: "piped",
    });

    const featureCommit = new TextDecoder().decode((await featureCommitCmd.output()).stdout).trim();
    const mainCommit = new TextDecoder().decode((await mainCommitCmd.output()).stdout).trim();

    assert(featureCommit !== mainCommit, "Branches should have diverged");

    // Verify review registry has correct metadata for conflict detection
    const reviews = await reviewRegistry.list({ trace_id: traceId });
    assertEquals(reviews.length, 1);
    assertEquals(reviews[0].base_branch, TEST_DEFAULT_BRANCH);
    assertEquals(reviews[0].branch, createdPortalBranch);
  });
});
