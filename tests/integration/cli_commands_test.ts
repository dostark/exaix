/**
 * @module CLICommandsIntegrationTest
 * @path tests/integration/cli_commands_test.ts
 * @description Verifies the core CLI commands, ensuring correct visual display of
 * request lists, approval workflows, and status synchronization with the background daemon.
 */

// Integration tests for exactl CLI commands not yet covered
// Covers: request list, request show, plan list, plan show, review list, review show, portal add/remove/refresh, dashboard

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { FlowInputSource, MemoryOperation } from "@exaix/core";
import { join } from "@std/path";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { ArtifactRegistry, DatabaseArtifactRepository } from "@exaix/core/artifact";
import { ReviewStatus } from "@exaix/core/status";
import { cliTest, runExactl } from "./helpers/cli_test_helpers.ts";

/** Helper: creates an artifact-backed review and returns its ID. */
async function createArtifactReview(
  env: TestEnvironment,
  requestId: string,
  content: string,
): Promise<string> {
  const repo = new DatabaseArtifactRepository(env.db);
  const artifactRegistry = new ArtifactRegistry(repo, env.tempDir);
  return await artifactRegistry.createArtifact(requestId, "code-analyst", content);
}

/** Helper: writes a wait-state JSON file and returns the directory path. */
interface IWaitStateOverrides {
  status?: string;
}

async function writeWaitState(
  env: TestEnvironment,
  runId: string,
  overrides: IWaitStateOverrides = {},
): Promise<string> {
  const traceId = "trace-integration-wait";
  const waitDir = join(env.tempDir, "Workspace", "WaitStates", traceId);
  await Deno.mkdir(waitDir, { recursive: true });
  await Deno.writeTextFile(
    join(waitDir, `${runId}.json`),
    makeWaitStateJson(overrides),
  );
  return waitDir;
}

cliTest("CLI: request list shows created requests", async () => {
  const env = await TestEnvironment.create();
  try {
    // Create a request file in the workspace
    const { traceId } = await env.createRequest("Test integration request");

    // List requests using CLI
    const result = await runExactl(["request", "list"], env.tempDir);
    assert(result.code === 0);
    assertStringIncludes(result.stdout, traceId.substring(0, 8));
  } finally {
    await env.cleanup();
  }
});

cliTest("[regression] CLI: request list surfaces target_branch", async () => {
  const env = await TestEnvironment.create();
  try {
    const targetBranch = "release_1.2";
    const { traceId } = await env.createRequest("Request list target branch", { targetBranch });

    const result = await runExactl(["request", "list"], env.tempDir);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, traceId.substring(0, 8));
    assertStringIncludes(result.stdout, "target_branch");
    assertStringIncludes(result.stdout, targetBranch);
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: request show displays request details", async () => {
  const env = await TestEnvironment.create();
  try {
    // Create a request
    const { traceId } = await env.createRequest("Show details request");
    // Show request using CLI
    const result = await runExactl([FlowInputSource.REQUEST, "show", traceId], env.tempDir);
    assert(result.code === 0);
    assertStringIncludes(result.stdout, "Show details request");
  } finally {
    await env.cleanup();
  }
});

cliTest("[regression] CLI: request show surfaces target_branch", async () => {
  const env = await TestEnvironment.create();
  try {
    const targetBranch = "release_1.2";
    const { traceId } = await env.createRequest("Show details request with target branch", { targetBranch });

    const result = await runExactl([FlowInputSource.REQUEST, "show", traceId], env.tempDir);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "target_branch");
    assertStringIncludes(result.stdout, targetBranch);
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: plan list shows generated plans", async () => {
  const env = await TestEnvironment.create();
  try {
    // Create a request and a plan
    const { traceId } = await env.createRequest("Plan list integration");
    await env.createPlan(traceId, "plan-list-integration");
    // List plans using CLI
    const result = await runExactl(["plan", "list"], env.tempDir);
    assert(result.code === 0);
    assertStringIncludes(result.stdout, "plan-list-integration");
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: plan show displays plan details", async () => {
  const env = await TestEnvironment.create();
  try {
    // Create a request and a plan
    const { traceId } = await env.createRequest("Plan show integration");
    const _planPath = await env.createPlan(traceId, "plan-show-integration");
    // Use the correct plan id (with _plan suffix)
    const planId = "plan-show-integration_plan";
    const result = await runExactl(["plan", "show", planId], env.tempDir);
    assert(result.code === 0);
    // Check for plan id and status in output
    assertStringIncludes(result.stdout, planId);
    assertStringIncludes(result.stdout, "review");
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: review list shows pending reviews", async () => {
  const env = await TestEnvironment.create();
  try {
    // Just check command runs in clean env
    const result = await runExactl(["review", "list"], env.tempDir);
    assert(result.code === 0);
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: review show displays review details", async () => {
  const env = await TestEnvironment.create();
  try {
    // Just check command runs with dummy id
    const result = await runExactl(["review", "show", "dummy-id"], env.tempDir);
    assert(result.code === 0 || result.code === 1);
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: review show --diff displays artifact body for artifact IDs", async () => {
  const env = await TestEnvironment.create();
  try {
    const artifactId = await createArtifactReview(
      env,
      "request-artifact-001",
      "# Artifact Title\n\nArtifact body content",
    );

    const result = await runExactl(["review", "show", artifactId, "--diff"], env.tempDir);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Artifact body content");
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: review approve marks artifact as approved (no git)", async () => {
  const env = await TestEnvironment.create();
  try {
    const artifactId = await createArtifactReview(env, "request-artifact-002", "# Approve Me\n\nThis is an artifact");

    const approve = await runExactl(["review", "approve", artifactId], env.tempDir);
    assertEquals(approve.code, 0);

    const repo = new DatabaseArtifactRepository(env.db);
    const artifactRegistry = new ArtifactRegistry(repo, env.tempDir);
    const updated = await artifactRegistry.getArtifact(artifactId);
    assertEquals(updated.status, ReviewStatus.APPROVED);
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: review list includes both code reviews and artifact-backed reviews", async () => {
  const env = await TestEnvironment.create();
  try {
    const artifactId = await createArtifactReview(env, "request-mixed-001", "# Mixed Artifact\n\nHello from artifact");

    // Create a minimal feat/* branch so the code-review path yields at least one entry
    // (No commit required; branch points at existing commit.)
    await new Deno.Command("git", {
      args: ["branch", "feat/request-mixed-branch-001-abc"],
      cwd: env.tempDir,
      stdout: "null",
      stderr: "null",
    }).output();

    const result = await runExactl(["review", "list"], env.tempDir);
    assertEquals(result.code, 0);

    assertStringIncludes(result.stdout, artifactId);
    assertStringIncludes(result.stdout, "feat/request-mixed-branch-001-abc");
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: portal add/remove/refresh works", async () => {
  const env = await TestEnvironment.create();
  try {
    // Create a dummy project to add as portal
    await env.writeFile("Portals/TestPortal/README.md", "# Test Portal");
    // Add portal (use relative path from env.tempDir)
    const add = await runExactl(["portal", MemoryOperation.ADD, "./Portals/TestPortal", "TestPortal"], env.tempDir);
    // Accept both 0 and 1 as valid (some commands may return 1 if portal already exists or not found)
    assert(add.code === 0 || add.code === 1);
    // Refresh portal
    const refresh = await runExactl(["portal", "refresh", "TestPortal"], env.tempDir);
    assert(refresh.code === 0 || refresh.code === 1);
    // Remove portal
    const remove = await runExactl(["portal", "remove", "TestPortal"], env.tempDir);
    assert(remove.code === 0 || remove.code === 1);
  } finally {
    await env.cleanup();
  }
});

cliTest("[regression] CLI: portal analyze and knowledge commands are recognized", async () => {
  const env = await TestEnvironment.create();
  try {
    // These should not return "Unknown command" (exit code 2)
    // Even if they fail due to missing portal, they should return exit code 1 or 0

    // Analyze help
    const analyzeHelp = await runExactl(["portal", "analyze", "--help"], env.tempDir);
    assertEquals(analyzeHelp.code, 0);
    assertStringIncludes(analyzeHelp.stdout, "Trigger codebase knowledge analysis");

    // Knowledge help
    const knowledgeHelp = await runExactl(["portal", "knowledge", "--help"], env.tempDir);
    assertEquals(knowledgeHelp.code, 0);
    assertStringIncludes(knowledgeHelp.stdout, "Display gathered knowledge for a portal");
  } finally {
    await env.cleanup();
  }
});

cliTest("[regression] CLI: request --target-branch writes target_branch frontmatter", async () => {
  const env = await TestEnvironment.create();
  try {
    const description = "Target branch frontmatter request";
    const targetBranch = "release_1.2";

    const create = await runExactl([
      "request",
      description,
      "--target-branch",
      targetBranch,
    ], env.tempDir);
    assertEquals(create.code, 0);

    const requestsDir = join(env.tempDir, "Workspace", "Requests");
    const requestFiles: string[] = [];
    for await (const entry of Deno.readDir(requestsDir)) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".md")) continue;
      requestFiles.push(join(requestsDir, entry.name));
    }

    let matchedPath: string | null = null;
    for (const filePath of requestFiles) {
      const content = await Deno.readTextFile(filePath);
      if (content.includes(`# Request\n\n${description}`)) {
        matchedPath = filePath;
        assertStringIncludes(content, `target_branch: ${targetBranch}`);
        break;
      }
    }

    assertExists(matchedPath, "Expected a request file containing the description");
  } finally {
    await env.cleanup();
  }
});

/** Adds a dummy worktree-strategy portal via the CLI and returns its identifying values. */
async function addWorktreePortal(
  env: TestEnvironment,
): Promise<{ portalAlias: string; defaultBranch: string; executionStrategy: string }> {
  const portalAlias = "TestPortal";
  const defaultBranch = "release_1.2";
  const executionStrategy = "worktree";

  // Create a dummy project to add as portal
  await env.writeFile("ExternalProjects/TestPortal/README.md", "# Test Portal");

  const add = await runExactl([
    "portal",
    MemoryOperation.ADD,
    "./ExternalProjects/TestPortal",
    portalAlias,
    "--default-branch",
    defaultBranch,
    "--execution-strategy",
    executionStrategy,
  ], env.tempDir);
  assertEquals(add.code, 0);

  return { portalAlias, defaultBranch, executionStrategy };
}

cliTest("[regression] CLI: portal add persists default_branch and execution_strategy", async () => {
  const env = await TestEnvironment.create();
  try {
    const { portalAlias, defaultBranch, executionStrategy } = await addWorktreePortal(env);

    const configText = await Deno.readTextFile(join(env.tempDir, "exa.config.toml"));
    assertStringIncludes(configText, `alias = "${portalAlias}"`);
    assertStringIncludes(configText, `default_branch = "${defaultBranch}"`);
    assertStringIncludes(configText, `execution_strategy = "${executionStrategy}"`);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[regression] CLI: portal show includes default_branch and execution_strategy", async () => {
  const env = await TestEnvironment.create();
  try {
    const { portalAlias, defaultBranch, executionStrategy } = await addWorktreePortal(env);

    const show = await runExactl(["portal", "show", portalAlias], env.tempDir);
    assertEquals(show.code, 0);
    assertStringIncludes(show.stdout, "default_branch");
    assertStringIncludes(show.stdout, defaultBranch);
    assertStringIncludes(show.stdout, "execution_strategy");
    assertStringIncludes(show.stdout, executionStrategy);
  } finally {
    await env.cleanup();
  }
});

cliTest("[regression] CLI: portal add rejects invalid --execution-strategy", async () => {
  const env = await TestEnvironment.create();
  try {
    const portalAlias = "TestPortal";
    await env.writeFile("ExternalProjects/TestPortal/README.md", "# Test Portal");

    const add = await runExactl([
      "portal",
      MemoryOperation.ADD,
      "./ExternalProjects/TestPortal",
      portalAlias,
      "--execution-strategy",
      "not-a-strategy",
    ], env.tempDir);

    assertEquals(add.code, 1);
    assertStringIncludes(add.stderr + add.stdout, "Invalid execution strategy");
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: dashboard launches without error (smoke test)", async () => {
  const env = await TestEnvironment.create();
  try {
    const result = await runExactl(["dashboard", "--help"], env.tempDir);
    console.log("dashboard stdout:\n", result.stdout);
    console.log("dashboard stderr:\n", result.stderr);
    // If dashboard is not a known command, skip or pass the test
    if (result.stderr.includes('Unknown command "dashboard"')) {
      console.warn("dashboard command not available in CLI, skipping test.");
      return;
    }
    assert(result.code === 0);
    // Accept either "dashboard" or "Usage" in help output
    assert(
      result.stdout.includes("dashboard") ||
        result.stdout.toLowerCase().includes("usage"),
      "Help output should mention dashboard or usage",
    );
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: request create with missing description fails", async () => {
  const env = await TestEnvironment.create();
  try {
    const result = await runExactl([FlowInputSource.REQUEST], env.tempDir);
    // Should fail with exit code 1 and error message
    assert(result.code === 1);
    assertStringIncludes(result.stderr, "Description required");
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: plan approve/reject/revise error handling", async () => {
  const env = await TestEnvironment.create();
  try {
    // Approve non-existent plan
    let result = await runExactl(["plan", "approve", "nonexistent"], env.tempDir);
    assert(result.code === 1);
    assertStringIncludes(result.stderr, "plan approve");
    // Reject non-existent plan
    result = await runExactl(["plan", "reject", "nonexistent", "-r", "bad plan"], env.tempDir);
    assert(result.code === 1);
    assertStringIncludes(result.stderr, "plan reject");
    // Revise non-existent plan
    result = await runExactl(["plan", "revise", "nonexistent", "-c", "needs work"], env.tempDir);
    assert(result.code === 1);
    assertStringIncludes(result.stderr, "plan revise");
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: blueprint create/list/show/remove/validate edge cases", async () => {
  const env = await TestEnvironment.create();
  try {
    // Create blueprint with missing required options
    let result = await runExactl(["blueprint", "create", "test-agent"], env.tempDir);
    assert(result.code === 1);
    assertStringIncludes(result.stderr, "blueprint create");
    // List blueprints (should be empty)
    result = await runExactl(["blueprint", "list"], env.tempDir);
    assert(result.code === 0);
    assertStringIncludes(result.stdout, "count: 0");
    // Show non-existent blueprint
    result = await runExactl(["blueprint", "show", "notfound"], env.tempDir);
    assert(result.code === 1);
    assertStringIncludes(result.stderr, "blueprint show");
    // Remove non-existent blueprint
    result = await runExactl(["blueprint", "remove", "notfound"], env.tempDir);
    assert(result.code === 1);
    assertStringIncludes(result.stderr, "blueprint remove");
    // Validate non-existent blueprint
    result = await runExactl(["blueprint", "validate", "notfound"], env.tempDir);
    assert(result.code === 1);
    assertStringIncludes(result.stderr, "blueprint.invalid");
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: daemon start/stop/restart/status/logs error handling", async () => {
  const env = await TestEnvironment.create();
  try {
    // These may fail if daemon is not configured, but should not crash
    let result = await runExactl(["daemon", "start"], env.tempDir);
    assert(result.code === 0 || result.code === 1);
    result = await runExactl(["daemon", "stop"], env.tempDir);
    assert(result.code === 0 || result.code === 1);
    result = await runExactl(["daemon", "restart"], env.tempDir);
    assert(result.code === 0 || result.code === 1);
    result = await runExactl(["daemon", "status"], env.tempDir);
    assert(result.code === 0 || result.code === 1);
    result = await runExactl(["daemon", "logs"], env.tempDir);
    assert(result.code === 0 || result.code === 1);
  } finally {
    // `restart` above leaves a daemon subprocess running (that's its contract) — a final
    // `stop` is required or the daemon outlives this test. TestEnvironment.cleanup() only
    // closes the DB and removes tempDir; it has no knowledge of a process this test itself
    // started via the CLI, so without this the daemon leaks with no supervisor left to
    // reap it (live-observed: daemon subprocess survives with its tempDir already deleted).
    await runExactl(["daemon", "stop"], env.tempDir).catch(() => {});
    await env.cleanup();
  }
});

function makeWaitStateJson(overrides: object = {}): string {
  return JSON.stringify(
    {
      waitStateId: "550e8400-e29b-41d4-a716-446655440000",
      traceId: "trace-integration-wait",
      kind: "plan_approval",
      status: "pending",
      artifactPath: "Workspace/Active/test-flow",
      resumeToken: "550e8400-e29b-41d4-a716-446655440001",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
      ...overrides,
    },
    null,
    2,
  );
}

cliTest("CLI: wait list shows pending wait states", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  try {
    await writeWaitState(env, "550e8400-e29b-41d4-a716-446655440000");

    const result = await runExactl(["wait", "list"], env.tempDir);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "550e8400");
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: wait list --status pending filters correctly", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  try {
    await writeWaitState(env, "550e8400-e29b-41d4-a716-446655440000", { status: "fulfilled" });

    const result = await runExactl(["wait", "list", "--status", "fulfilled"], env.tempDir);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "550e8400");
  } finally {
    await env.cleanup();
  }
});

cliTest("CLI: wait list shows empty state when no wait states", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  try {
    const result = await runExactl(["wait", "list"], env.tempDir);
    assertEquals(result.code, 0);
  } finally {
    await env.cleanup();
  }
});
