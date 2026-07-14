/**
 * @module ExecutionLoopPortalRegressionTest
 * @path packages/execution/tests/execution_loop_portal_regression_test.ts
 * @description Regression tests for the execution loop, ensuring correct handling
 * of portal-specific tool calls and cross-portal file access.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ExecutionLoop } from "@exaix/execution";
import { GitService } from "@exaix/git";
import { ToolRegistry } from "@exaix/tool-runtime";
import { MemoryBankService } from "@exaix/memory";
import { createMockConfig } from "@exaix/testing";
import { initTestDbService } from "@exaix/testing";
import { ReviewRegistry } from "@exaix/core/artifact";
import { EventLogger } from "@exaix/core/logger";
import { ensureDir } from "@std/fs/ensure-dir";
import { PlanStatus } from "@exaix/core/status";
import { PortalOperation } from "@exaix/core";

Deno.test("[regression] ExecutionLoop: targets portal directory and creates review", async () => {
  const rootDir = await Deno.makeTempDir({ prefix: "exec-portal-reg-" });
  const portalDir = join(rootDir, "my-portal");
  await ensureDir(portalDir);

  // Initialize git in portal with initial commit
  const initCmd = new Deno.Command("git", {
    args: ["init", "-b", "master"],
    cwd: portalDir,
  });
  await initCmd.output();

  // Configure git identity
  await new Deno.Command("git", {
    args: ["config", "user.name", "Test User"],
    cwd: portalDir,
  }).output();
  await new Deno.Command("git", {
    args: ["config", "user.email", "test@test.com"],
    cwd: portalDir,
  }).output();

  // Create initial commit
  await Deno.writeTextFile(join(portalDir, ".gitignore"), "*.tmp\n");
  await new Deno.Command("git", {
    args: ["add", ".gitignore"],
    cwd: portalDir,
  }).output();
  await new Deno.Command("git", {
    args: ["commit", "-m", "Initial commit"],
    cwd: portalDir,
  }).output();

  const { db, cleanup } = await initTestDbService();
  try {
    const config = createMockConfig(rootDir);
    // Use branch execution strategy to avoid worktree conflicts
    config.portals = [{
      alias: "my-portal",
      target_path: portalDir,
      default_branch: "master",
      identities_allowed: ["*"],
      operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
    }];

    const activeDir = join(rootDir, config.paths.workspace, "Active");
    await ensureDir(activeDir);

    const logger = new EventLogger({ db, defaultActor: "user:test" });
    const reviewRegistry = new ReviewRegistry(db, logger);
    const loop = new ExecutionLoop({
      config,
      db,
      identityId: "test-agent",
      reviewRegistry,
      gitServiceFactory: {
        createGitService(repoPath: string, traceId: string) {
          return new GitService({ config, traceId, identityId: "test-agent", repoPath });
        },
      },
      toolRegistryFactory: {
        createToolRegistry(traceId: string, baseDir: string) {
          return new ToolRegistry({ config, traceId, identityId: "test-agent", baseDir });
        },
      },
      memoryBank: new MemoryBankService(config, logger),
    });

    const traceId = crypto.randomUUID();
    const planContent = `---
trace_id: "${traceId}"
request_id: portal-reg-request
status: ${PlanStatus.APPROVED}
portal: my-portal
---

# Portal Regression Plan

\`\`\`toml
tool = "write_file"
description = "Write file to portal"

[params]
path = "hello.txt"
content = "hello from portal"
\`\`\`
`;

    const planPath = join(activeDir, "portal-reg-request_plan.md");
    await Deno.writeTextFile(planPath, planContent);

    // This should detect the portal and execute there
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true, "Execution failed: " + result.error);

    // Verify review was registered (worktree isolation means changes are in worktree branch)
    const reviews = await reviewRegistry.list({ portal: "my-portal" });
    assertEquals(reviews.length, 1, "Should have registered 1 review");
    assertEquals(reviews[0].portal, "my-portal");
    assertExists(reviews[0].commit_sha, "Review should have a commit SHA");
    assertExists(reviews[0].branch, "Review should have a branch");
  } finally {
    await cleanup();
    await Deno.remove(rootDir, { recursive: true });
  }
});
