/**
 * @module PlanExecutorTest
 * @path packages/routing/tests/plan_executor_test.ts
 * @description Verifies the core PlanExecutor service, ensuring sequential tool execution,
 * robust failure recovery, and correct propagation of step results.
 */

import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  type FlowStepType as _FlowStepType,
  type MemoryOperation as _MemoryOperation,
  PortalOperation as _PortalOperation,
} from "@exaix/core";
import { join } from "@std/path";
import { type IPlanContext, PlanExecutor } from "@exaix/core/planning";
import { MockProvider } from "@exaix/ai/providers.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { createGitTestContext, GitTestHelper, TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { readFixtureTextSync } from "@exaix/testing";

const BASIC_TEST_BLUEPRINT =
  `---\nname: test-agent\nmodel: mock-model\nprovider: mock\ncapabilities: ["write"]\nallowed_paths: ["*"]\n---\nYou are a test agent.\n`;

interface IPlanExecutorTestContext {
  tempDir: string;
  repoDir: string;
  db: Awaited<ReturnType<typeof createGitTestContext>>["db"];
  config: Awaited<ReturnType<typeof createGitTestContext>>["config"];
  git: Awaited<ReturnType<typeof createGitTestContext>>["git"];
  helper: GitTestHelper;
  writeBlueprint: (content: string) => Promise<void>;
  createExecutor: (
    provider: IModelProvider,
    options?: ConstructorParameters<typeof PlanExecutor>[5],
  ) => PlanExecutor;
}

interface IPlanExecutorTestOptions {
  ensureGit?: boolean;
}

async function withPlanExecutorTestContext(
  prefix: string,
  run: (context: IPlanExecutorTestContext) => Promise<void>,
  options: IPlanExecutorTestOptions = {},
): Promise<void> {
  const testContext = await createGitTestContext(prefix);
  const { tempDir, repoDir, db, cleanup, config, git } = testContext;
  const helper = new GitTestHelper(repoDir);
  const blueprintsDir = join(config.system.root, config.paths.blueprints, "Agents");

  try {
    if (options.ensureGit !== false) {
      await git.ensureRepository();
      await git.ensureIdentity();
    }

    await Deno.mkdir(blueprintsDir, { recursive: true });

    const writeBlueprint = async (content: string): Promise<void> => {
      await Deno.writeTextFile(join(blueprintsDir, "test-agent.md"), content);
    };

    const createExecutor = (
      provider: IModelProvider,
      executorOptions?: ConstructorParameters<typeof PlanExecutor>[5],
    ): PlanExecutor => new PlanExecutor(config, provider, db, repoDir, undefined, executorOptions);

    await run({ tempDir, repoDir, db, config, git, helper, writeBlueprint, createExecutor });
  } finally {
    await cleanup();
  }
}

Deno.test("PlanExecutor: executes plan steps successfully", async () => {
  await withPlanExecutorTestContext(
    "plan-exec-test-",
    async ({ tempDir, repoDir, helper, writeBlueprint, createExecutor }) => {
      const fixture_1 = readFixtureTextSync(import.meta.url, "services", "plan", "plan_executor_test", "fixture_1.md");
      await writeBlueprint(fixture_1);

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
      const executor = createExecutor(mockProvider);

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
      const planPath = join(tempDir, "Workspace/Active/plan.md");
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

      // Verify step commit exists in the log.
      const log = await helper.runGit(["log", "--oneline"]);
      const commits = log.trim().split("\n");
      assert(commits.length >= 2, "Should have at least 2 commits");
      assert(log.includes("Step 1: Create File"), "Should have step commit");
    },
  );
});

Deno.test("PlanExecutor: handles multiple steps", async () => {
  await withPlanExecutorTestContext(
    "plan-exec-multi-",
    async ({ tempDir, repoDir, writeBlueprint, createExecutor }) => {
      const fixture_2 = readFixtureTextSync(import.meta.url, "services", "plan", "plan_executor_test", "fixture_2.md");
      await writeBlueprint(fixture_2);

      // SmartMockProvider provides step-specific responses based on prompt contents.
      class SmartMockProvider extends MockProvider {
        override generate(prompt: string): Promise<IGenerateResult> {
          let content = "";
          if (prompt.includes("CURRENT TASK:\nStep 1")) {
            content = `
\`\`\`toml
[[actions]]
tool = "write_file"
[actions.params]
path = "step1.txt"
content = "Step 1"
\`\`\`
`;
          } else if (prompt.includes("CURRENT TASK:\nStep 2")) {
            content = `
\`\`\`toml
[[actions]]
tool = "write_file"
[actions.params]
path = "step2.txt"
content = "Step 2"
\`\`\`
`;
          }
          return Promise.resolve({
            content,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            model: "smart-mock",
            provider: "mock",
            cost_usd: 0,
          });
        }
      }

      const mockProvider = new SmartMockProvider("");
      const executor = createExecutor(mockProvider);

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

      const result = await executor.execute(join(tempDir, "plan.md"), context);
      const sha = result.lastCommitSha;
      assertExists(sha);

      // Verify both files created
      const content1 = await Deno.readTextFile(join(repoDir, "step1.txt"));
      assertEquals(content1, "Step 1");
      const content2 = await Deno.readTextFile(join(repoDir, "step2.txt"));
      assertEquals(content2, "Step 2");
    },
  );
});

Deno.test("PlanExecutor: handles tool execution failure", async () => {
  await withPlanExecutorTestContext("plan-exec-fail-", async ({ tempDir, writeBlueprint, createExecutor }) => {
    const fixture_3 = readFixtureTextSync(import.meta.url, "services", "plan", "plan_executor_test", "fixture_3.md");
    await writeBlueprint(fixture_3);

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
    const executor = createExecutor(mockProvider);

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000003",
      request_id: "req-fail",
      identity: "test-agent",
      frontmatter: {},
      steps: [{ number: 1, title: "Fail", content: "Fail" }],
    };

    // Should throw
    await assertRejects(
      async () => await executor.execute(join(tempDir, "plan.md"), context),
      Error,
      "Tool 'non_existent_tool' not found",
    );
  });
});

Deno.test("PlanExecutor: handles no actions generated", async () => {
  await withPlanExecutorTestContext("plan-exec-no-act-", async ({ tempDir, writeBlueprint, createExecutor }) => {
    await writeBlueprint(BASIC_TEST_BLUEPRINT);

    // Mock response with no actions
    const mockProvider = new MockProvider("No actions here");
    const executor = createExecutor(mockProvider);

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000004",
      request_id: "req-no-act",
      identity: "test-agent",
      frontmatter: {},
      steps: [{ number: 1, title: "No Action", content: "Do nothing" }],
    };

    // Should return null (no commit)
    const result = await executor.execute(join(tempDir, "plan.md"), context);
    const sha = result.lastCommitSha;
    assertEquals(sha, null);
  });
});

Deno.test("PlanExecutor: handles malformed TOML", async () => {
  await withPlanExecutorTestContext("plan-exec-bad-toml-", async ({ tempDir, writeBlueprint, createExecutor }) => {
    await writeBlueprint(BASIC_TEST_BLUEPRINT);

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
    const executor = createExecutor(mockProvider);

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000005",
      request_id: "req-bad",
      identity: "test-agent",
      frontmatter: {},
      steps: [{ number: 1, title: "Bad TOML", content: "Bad" }],
    };

    // Should return null because parsing fails -> no actions -> warning -> return null
    const result = await executor.execute(join(tempDir, "plan.md"), context);
    const sha = result.lastCommitSha;
    assertEquals(sha, null);
  });
});

Deno.test("PlanExecutor: handles tool failure (result.success=false)", async () => {
  await withPlanExecutorTestContext("plan-exec-fail-res-", async ({ tempDir, writeBlueprint, createExecutor }) => {
    const fixture_4 = readFixtureTextSync(import.meta.url, "services", "plan", "plan_executor_test", "fixture_4.md");
    await writeBlueprint(fixture_4);

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
    const executor = createExecutor(mockProvider);

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000006",
      request_id: "req-fail-res",
      identity: "test-agent",
      frontmatter: {},
      steps: [{ number: 1, title: "Fail Result", content: "Fail" }],
    };

    // Should throw because tool returns success: false
    await assertRejects(
      async () => await executor.execute(join(tempDir, "plan.md"), context),
      Error,
      "File: non_existent.txt not found",
    );
  });
});

Deno.test("PlanExecutor: handles step with no changes", async () => {
  await withPlanExecutorTestContext(
    "plan-exec-no-change-",
    async ({ tempDir, repoDir, helper, writeBlueprint, createExecutor }) => {
      await writeBlueprint(BASIC_TEST_BLUEPRINT);

      // Pre-create file
      // Note: It must be in repoDir for PlanExecutor (with baseDir=repoDir) to find it
      await Deno.writeTextFile(join(repoDir, "read.txt"), "Original content");
      await helper.createFileAndCommit("read.txt", "Original content", "Initial commit");
      const _initialSha = await helper.getCommitSha("HEAD");
      const mockResponse = `
\`\`\`toml
[[actions]]
tool = "read_file"
[actions.params]
path = "read.txt"
\`\`\`
`;
      const mockProvider = new MockProvider(mockResponse);
      const executor = createExecutor(mockProvider);

      const context: IPlanContext = {
        trace_id: "00000000-0000-0000-0000-000000000007",
        request_id: "req-no-change",
        identity: "test-agent",
        frontmatter: {},
        steps: [{ number: 1, title: "Read Only", content: "Read" }],
      };

      // Should return null (no commit created for step)
      const result = await executor.execute(join(tempDir, "plan.md"), context);
      const sha = result.lastCommitSha;
      assertEquals(sha, null);
    },
  );
});

Deno.test("PlanExecutor: handles execution without git", async () => {
  await withPlanExecutorTestContext(
    "plan-exec-no-git-",
    async ({ tempDir, repoDir, writeBlueprint, createExecutor }) => {
      const fixture_5 = readFixtureTextSync(import.meta.url, "services", "plan", "plan_executor_test", "fixture_5.md");
      await writeBlueprint(fixture_5);

      const mockResponse =
        `\`\`\`toml\n[[actions]]\ntool = "write_file"\n[actions.params]\npath = "no-git.txt"\ncontent = "No Git"\n\`\`\``;
      const mockProvider = new MockProvider(mockResponse);
      const executor = createExecutor(mockProvider, { enableGit: false });

      const context: IPlanContext = {
        trace_id: "00000000-0000-0000-0000-000000000008",
        request_id: "req-no-git",
        identity: "test-agent",
        frontmatter: {},
        steps: [{ number: 1, title: "No Git", content: "No Git" }],
      };

      const result = await executor.execute(join(tempDir, "plan.md"), context);
      assertEquals(result.lastCommitSha, null);

      const content = await Deno.readTextFile(join(repoDir, "no-git.txt"));
      assertEquals(content, "No Git");
    },
    { ensureGit: false },
  );
});

Deno.test("PlanExecutor: handles portal context in frontmatter", async () => {
  await withPlanExecutorTestContext(
    "plan-exec-portal-",
    async ({ tempDir, config, writeBlueprint, createExecutor }) => {
      const portalDir = join(tempDir, "TargetPortal");
      await Deno.mkdir(portalDir, { recursive: true });

      // Update config to include portal
      config.portals = [{
        alias: "MyPortal",
        target_path: portalDir,
        default_branch: TEST_DEFAULT_BRANCH,
        agents_allowed: ["*"],
        operations: [_PortalOperation.READ, _PortalOperation.WRITE, _PortalOperation.GIT],
      }];

      const fixture_6 = readFixtureTextSync(import.meta.url, "services", "plan", "plan_executor_test", "fixture_6.md");
      await writeBlueprint(fixture_6);

      const mockResponse =
        `\`\`\`toml\n[[actions]]\ntool = "write_file"\n[actions.params]\npath = "portal-file.txt"\ncontent = "In Portal"\n\`\`\``;
      const mockProvider = new MockProvider(mockResponse);
      const executor = createExecutor(mockProvider, { enableGit: false });

      const context: IPlanContext = {
        trace_id: "00000000-0000-0000-0000-000000000009",
        request_id: "req-portal",
        identity: "test-agent",
        frontmatter: { portal: "MyPortal" },
        steps: [{ number: 1, title: "Portal Step", content: "Write in portal" }],
      };

      await executor.execute(join(tempDir, "plan.md"), context);

      const content = await Deno.readTextFile(join(portalDir, "portal-file.txt"));
      assertEquals(content, "In Portal");
    },
    { ensureGit: false },
  );
});

Deno.test("PlanExecutor: generates execution report", async () => {
  await withPlanExecutorTestContext("plan-exec-report-", async ({ tempDir, createExecutor }) => {
    const mockResponse = "This is a report analysis.";
    const mockProvider = new MockProvider(mockResponse);
    const executor = createExecutor(mockProvider, { generateReport: true, enableGit: false });

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000010",
      request_id: "req-report",
      identity: "test-agent",
      frontmatter: {},
      steps: [], // No steps will trigger report even if generateReport is false, but we set it true
    };

    const result = await executor.execute(join(tempDir, "plan.md"), context);
    assertEquals(result.report, "This is a report analysis.");
  }, { ensureGit: false });
});

Deno.test("PlanExecutor: passes its executionRoot (worktree path) to the code-changes delegate", async () => {
  // Delegate must be invoked with the real worktree path PlanExecutor was constructed with.
  await withPlanExecutorTestContext(
    "plan-exec-delegate-worktree-",
    async ({ repoDir, writeBlueprint, createExecutor }) => {
      await writeBlueprint(BASIC_TEST_BLUEPRINT);

      const received: {
        traceId?: string;
        step?: { title: string; content: string; successCriteria?: string[] };
        worktreePath?: string;
      } = {};
      const executor = createExecutor(new MockProvider("noop"), {
        onCodeChangesDelegate: (
          traceId: string,
          step: { title: string; content: string; successCriteria?: string[] },
          worktreePath: string,
        ) => {
          received.traceId = traceId;
          received.step = step;
          received.worktreePath = worktreePath;
          return Promise.resolve("changes_made");
        },
      });

      const context: IPlanContext = {
        trace_id: "00000000-0000-0000-0000-0000000000aa",
        request_id: "req-wt",
        identity: "test-agent",
        frontmatter: { trace_id: "00000000-0000-0000-0000-0000000000aa", request_id: "req-wt" },
        steps: [{ number: 1, title: "Edit code", content: "Make a code change" }],
      };

      await executor.execute(join("/tmp", "unused_plan.md"), context);

      // The delegate was invoked with the executor's real worktree root and step content.
      assertEquals(received.worktreePath, repoDir);
      assertEquals(received.step?.title, "Edit code");
      assertEquals(received.step?.content, "Make a code change");
    },
  );
});
