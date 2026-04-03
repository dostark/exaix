/**
 * @module PlanExecutorTest
 * @path tests/services/plan/plan_executor_test.ts
 * @description Verifies the core PlanExecutor service, ensuring sequential tool execution,
 * robust failure recovery, and correct propagation of step results.
 */

import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  FlowStepType as _FlowStepType,
  MemoryOperation as _MemoryOperation,
  PortalOperation as _PortalOperation,
} from "../../../src/shared/enums.ts";
import { join } from "@std/path";
import { type IPlanContext, PlanExecutor } from "../../../src/services/plan/plan_executor.ts";
import { MockProvider } from "../../../src/ai/providers.ts";
import { createGitTestContext, GitTestHelper } from "../../helpers/git_test_helper.ts";
import { TEST_DEFAULT_BRANCH } from "../../helpers/constants.ts";

Deno.test("PlanExecutor: executes plan steps successfully", async () => {
  const { tempDir: _tempDir, repoDir, db, cleanup, config, git } = await createGitTestContext("plan-exec-test-");
  const helper = new GitTestHelper(repoDir);

  try {
    // Setup git repo
    await git.ensureRepository();
    await git.ensureIdentity();

    // Create blueprint without mcp capability so Legacy strategy is used
    const blueprintsDir = join(config.paths.blueprints, "Identities");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    await Deno.writeTextFile(
      join(blueprintsDir, "test-agent.md"),
      `---
name: test-agent
model: mock-model
provider: mock
capabilities: ["write"]
allowed_paths: ["test.txt"]
---
You are a test agent.
`,
    );

    // Mock LLM response with TOML actions
    const mockResponse = `
Here are the actions for the step:

\`\`\`toml
[[actions]]
tool = "write_file"
description = "Create test file"
[actions.params]
path = "test.txt"
content = "Hello World"
\`\`\`
`;
    const mockProvider = new MockProvider(mockResponse);

    // Initialize executor
    const executor = new PlanExecutor(config, mockProvider, db, repoDir);

    // Prepare plan context
    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000001",
      request_id: "req-123",
      identity: "test-agent",
      frontmatter: {
        trace_id: "00000000-0000-0000-0000-000000000001",
        request_id: "req-123",
      },
      steps: [
        {
          number: 1,
          title: "Create File",
          content: "Create a file named test.txt with content 'Hello World'",
        },
      ],
    };

    // Execute plan
    const planPath = join(_tempDir, "Workspace/Active/plan.md");
    const result = await executor.execute(planPath, context);
    const sha = result.lastCommitSha;

    // Verify result
    assertExists(sha, "Should return commit SHA");

    // Verify file created
    const fileContent = await Deno.readTextFile(join(repoDir, "test.txt"));
    assertEquals(fileContent, "Hello World");

    // Verify commit
    const commitMsg = await helper.getLastCommitMessage();
    // Since final commit had no changes, the last commit is the step commit
    assertEquals(commitMsg.includes("Step 1: Create File"), true);
    assertEquals(commitMsg.includes("Executed by agent"), false); // Final commit message not present

    // Verify step commit exists (intermediate commit)
    // We can check logs or just trust the final state for now,
    // but let's check if we have more than 1 commit (initial + step + final)
    // Actually GitTestHelper doesn't have commit count easily, but we can check log
    const log = await helper.runGit(["log", "--oneline"]);
    const commits = log.trim().split("\n");
    // Should have at least: "Complete plan...", "Step 1:...", "Initial commit" (if created by helper?)
    // GitTestHelper init doesn't create initial commit usually unless specified.
    // GitService.ensureRepository does init.
    // So we expect: "Complete plan...", "Step 1:..."
    assert(commits.length >= 2, "Should have at least 2 commits");
    assert(log.includes("Step 1: Create File"), "Should have step commit");
  } finally {
    await cleanup();
  }
});

Deno.test("PlanExecutor: handles multiple steps", async () => {
  const { tempDir: _tempDir, repoDir, db, cleanup, config, git } = await createGitTestContext("plan-exec-multi-");
  const _helper = new GitTestHelper(repoDir);

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    // Create blueprint without mcp capability so Legacy strategy is used
    const blueprintsDir = join(config.paths.blueprints, "Identities");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    await Deno.writeTextFile(
      join(blueprintsDir, "test-agent.md"),
      `---
name: test-agent
model: mock-model
provider: mock
capabilities: ["write"]
allowed_paths: ["step1.txt", "step2.txt"]
---
You are a test agent.
`,
    );

    // Mock LLM response - we need different responses for different steps
    // But MockProvider returns static response.
    // We might need to subclass MockProvider or make it smarter if we want dynamic responses.
    // For now, let's use a single response that works for both steps (e.g. overwriting same file or creating different files if we could control it)
    // Since we can't easily control it with simple MockProvider, let's just make it create the same file content but maybe different path if the prompt included path?
    // No, MockProvider ignores prompt.

    // Let's create a SmartMockProvider for this test
    class SmartMockProvider extends MockProvider {
      override generate(prompt: string): Promise<string> {
        if (prompt.includes("CURRENT TASK:\nStep 1")) {
          return Promise.resolve(`
\`\`\`toml
[[actions]]
tool = "write_file"
[actions.params]
path = "step1.txt"
content = "Step 1"
\`\`\`
`);
        } else if (prompt.includes("CURRENT TASK:\nStep 2")) {
          return Promise.resolve(`
\`\`\`toml
[[actions]]
tool = "write_file"
[actions.params]
path = "step2.txt"
content = "Step 2"
\`\`\`
`);
        }
        return Promise.resolve("");
      }
    }

    const mockProvider = new SmartMockProvider("");
    const executor = new PlanExecutor(config, mockProvider, db, repoDir);

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000002",
      request_id: "req-456",
      identity: "test-agent",
      frontmatter: {},
      steps: [
        { number: 1, title: "Step 1", content: "Do step 1" },
        { number: 2, title: "Step 2", content: "Do step 2" },
      ],
    };

    const result = await executor.execute(join(_tempDir, "plan.md"), context);
    const sha = result.lastCommitSha;
    assertExists(sha);

    // Verify both files created
    const content1 = await Deno.readTextFile(join(repoDir, "step1.txt"));
    assertEquals(content1, "Step 1");
    const content2 = await Deno.readTextFile(join(repoDir, "step2.txt"));
    assertEquals(content2, "Step 2");
  } finally {
    await cleanup();
  }
});

Deno.test("PlanExecutor: handles tool execution failure", async () => {
  const { tempDir: _tempDir, repoDir, db, cleanup, config, git } = await createGitTestContext("plan-exec-fail-");

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    // Create blueprint without mcp capability so Legacy strategy is used
    const blueprintsDir = join(config.paths.blueprints, "Identities");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    await Deno.writeTextFile(
      join(blueprintsDir, "test-agent.md"),
      `---
name: test-agent
model: mock-model
provider: mock
capabilities: ["write"]
allowed_paths: ["fail.txt"]
---
You are a test agent.
`,
    );

    // Mock response with invalid tool usage (e.g. write to root which might be allowed but let's try something that fails)
    // Or just use a non-existent tool? ToolRegistry throws if tool not found?
    // ToolRegistry throws "Unknown tool" if not found.
    const mockResponse = `
\`\`\`toml
[[actions]]
tool = "non_existent_tool"
[actions.params]
foo = "bar"
\`\`\`
`;
    const mockProvider = new MockProvider(mockResponse);
    const executor = new PlanExecutor(config, mockProvider, db, repoDir);

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000003",
      request_id: "req-fail",
      identity: "test-agent",
      frontmatter: {},
      steps: [{ number: 1, title: "Fail", content: "Fail" }],
    };

    // Should throw
    await assertRejects(
      async () => await executor.execute(join(_tempDir, "plan.md"), context),
      Error,
      "Tool 'non_existent_tool' not found",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PlanExecutor: handles no actions generated", async () => {
  const { tempDir: _tempDir, repoDir, db, cleanup, config, git } = await createGitTestContext("plan-exec-no-act-");

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    // Mock response with no actions
    const mockProvider = new MockProvider("No actions here");
    const executor = new PlanExecutor(config, mockProvider, db, repoDir);

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000004",
      request_id: "req-no-act",
      identity: "test-agent",
      frontmatter: {},
      steps: [{ number: 1, title: "No Action", content: "Do nothing" }],
    };

    // Should return null (no commit)
    const result = await executor.execute(join(_tempDir, "plan.md"), context);
    const sha = result.lastCommitSha;
    assertEquals(sha, null);
  } finally {
    await cleanup();
  }
});

Deno.test("PlanExecutor: handles malformed TOML", async () => {
  const { tempDir: _tempDir, repoDir, db, cleanup, config, git } = await createGitTestContext("plan-exec-bad-toml-");

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    // Mock response with malformed TOML
    const mockResponse = `
\`\`\`toml
[[actions]]
tool = "write_file"
[actions.params
path = "bad.txt"
\`\`\`
`;
    const mockProvider = new MockProvider(mockResponse);
    const executor = new PlanExecutor(config, mockProvider, db, repoDir);

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000005",
      request_id: "req-bad",
      identity: "test-agent",
      frontmatter: {},
      steps: [{ number: 1, title: "Bad TOML", content: "Bad" }],
    };

    // Should return null because parsing fails -> no actions -> warning -> return null
    const result = await executor.execute(join(_tempDir, "plan.md"), context);
    const sha = result.lastCommitSha;
    assertEquals(sha, null);
  } finally {
    await cleanup();
  }
});

Deno.test("PlanExecutor: handles tool failure (result.success=false)", async () => {
  const { tempDir: _tempDir, repoDir, db, cleanup, config, git } = await createGitTestContext("plan-exec-fail-res-");

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    // Create blueprint without mcp capability so Legacy strategy is used
    const blueprintsDir = join(config.paths.blueprints, "Identities");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    await Deno.writeTextFile(
      join(blueprintsDir, "test-agent.md"),
      `---
name: test-agent
model: mock-model
provider: mock
capabilities: ["write"]
allowed_paths: ["non_existent.txt"]
---
You are a test agent.
`,
    );

    // Mock response where tool returns success=false
    const mockResponse = `
\`\`\`toml
[[actions]]
tool = "read_file"
[actions.params]
path = "non_existent.txt"
\`\`\`
`;
    const mockProvider = new MockProvider(mockResponse);
    const executor = new PlanExecutor(config, mockProvider, db, repoDir);

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000006",
      request_id: "req-fail-res",
      identity: "test-agent",
      frontmatter: {},
      steps: [{ number: 1, title: "Fail Result", content: "Fail" }],
    };

    // Should throw because tool returns success: false
    await assertRejects(
      async () => await executor.execute(join(_tempDir, "plan.md"), context),
      Error,
      "File: non_existent.txt not found",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PlanExecutor: handles step with no changes", async () => {
  const { tempDir: _tempDir, repoDir, db, cleanup, config, git } = await createGitTestContext("plan-exec-no-change-");
  const _helper = new GitTestHelper(repoDir); // Fixed lint: prefixed with underscore

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    // Pre-create file
    // Note: It must be in repoDir for PlanExecutor (with baseDir=repoDir) to find it
    await Deno.writeTextFile(join(repoDir, "read.txt"), "Original content");
    await _helper.createFileAndCommit("read.txt", "Original content", "Initial commit");
    const _initialSha = await _helper.getCommitSha("HEAD");
    const mockResponse = `
\`\`\`toml
[[actions]]
tool = "read_file"
[actions.params]
path = "read.txt"
\`\`\`
`;
    const mockProvider = new MockProvider(mockResponse);
    const executor = new PlanExecutor(config, mockProvider, db, repoDir);

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000007",
      request_id: "req-no-change",
      identity: "test-agent",
      frontmatter: {},
      steps: [{ number: 1, title: "Read Only", content: "Read" }],
    };

    // Should return null (no commit created for step)
    const result = await executor.execute(join(_tempDir, "plan.md"), context);
    const sha = result.lastCommitSha;
    assertEquals(sha, null);
  } finally {
    await cleanup();
  }
});

Deno.test("PlanExecutor: handles execution without git", async () => {
  const { tempDir: _tempDir, repoDir, db, cleanup, config } = await createGitTestContext("plan-exec-no-git-");
  try {
    // Create blueprint without mcp capability so Legacy strategy is used
    const blueprintsDir = join(config.paths.blueprints, "Identities");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    await Deno.writeTextFile(
      join(blueprintsDir, "test-agent.md"),
      `---
name: test-agent
model: mock-model
provider: mock
capabilities: ["write"]
allowed_paths: ["no-git.txt"]
---
You are a test agent.
`,
    );

    const mockResponse =
      `\`\`\`toml\n[[actions]]\ntool = "write_file"\n[actions.params]\npath = "no-git.txt"\ncontent = "No Git"\n\`\`\``;
    const mockProvider = new MockProvider(mockResponse);
    const executor = new PlanExecutor(config, mockProvider, db, repoDir, { enableGit: false });

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000008",
      request_id: "req-no-git",
      identity: "test-agent",
      frontmatter: {},
      steps: [{ number: 1, title: "No Git", content: "No Git" }],
    };

    const result = await executor.execute(join(_tempDir, "plan.md"), context);
    assertEquals(result.lastCommitSha, null);

    const content = await Deno.readTextFile(join(repoDir, "no-git.txt"));
    assertEquals(content, "No Git");
  } finally {
    await cleanup();
  }
});

Deno.test("PlanExecutor: handles portal context in frontmatter", async () => {
  const { tempDir: _tempDir, repoDir, db, cleanup, config } = await createGitTestContext("plan-exec-portal-");
  try {
    const portalDir = join(_tempDir, "TargetPortal");
    await Deno.mkdir(portalDir, { recursive: true });

    // Update config to include portal
    config.portals = [{
      alias: "MyPortal",
      target_path: portalDir,
      default_branch: TEST_DEFAULT_BRANCH,
      identities_allowed: ["*"],
      operations: [_PortalOperation.READ, _PortalOperation.WRITE, _PortalOperation.GIT],
    }];

    // Create blueprint without mcp capability so Legacy strategy is used
    const blueprintsDir = join(config.paths.blueprints, "Identities");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    await Deno.writeTextFile(
      join(blueprintsDir, "test-agent.md"),
      `---
name: test-agent
model: mock-model
provider: mock
capabilities: ["write"]
allowed_paths: ["portal-file.txt"]
---
You are a test agent.
`,
    );

    const mockResponse =
      `\`\`\`toml\n[[actions]]\ntool = "write_file"\n[actions.params]\npath = "portal-file.txt"\ncontent = "In Portal"\n\`\`\``;
    const mockProvider = new MockProvider(mockResponse);
    const executor = new PlanExecutor(config, mockProvider, db, repoDir, { enableGit: false });

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000009",
      request_id: "req-portal",
      identity: "test-agent",
      frontmatter: { portal: "MyPortal" },
      steps: [{ number: 1, title: "Portal Step", content: "Write in portal" }],
    };

    await executor.execute(join(_tempDir, "plan.md"), context);

    const content = await Deno.readTextFile(join(portalDir, "portal-file.txt"));
    assertEquals(content, "In Portal");
  } finally {
    await cleanup();
  }
});

Deno.test("PlanExecutor: generates execution report", async () => {
  const { tempDir: _tempDir, repoDir, db, cleanup, config } = await createGitTestContext("plan-exec-report-");
  try {
    const mockResponse = "This is a report analysis.";
    const mockProvider = new MockProvider(mockResponse);
    const executor = new PlanExecutor(config, mockProvider, db, repoDir, { generateReport: true, enableGit: false });

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000010",
      request_id: "req-report",
      identity: "test-agent",
      frontmatter: {},
      steps: [], // No steps will trigger report even if generateReport is false, but we set it true
    };

    const result = await executor.execute(join(_tempDir, "plan.md"), context);
    assertEquals(result.report, "This is a report analysis.");
  } finally {
    await cleanup();
  }
});
