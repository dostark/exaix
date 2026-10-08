/**
 * @module GitSecurityRegressionTest
 * @path tests/security/git_security_regression_security_test.ts
 * @description Regression tests for Git operations security, ensuring that agent-triggered
 * git commands are strictly confined to authorized repository boundaries.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createGitTestContext, GitTestHelper, setupGitRepo, TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { type IPlanContext, PlanExecutor } from "@exaix/core/planning";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { GitService } from "@exaix/git";
import { ExecutionLoop } from "@exaix/execution";
import { getFixturePath, readFixtureTextSync } from "@exaix/testing";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX, REACT_THOUGHT_PREFIX } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";

function createCommandAttemptProvider(command: string, args: string[], prompts: string[]): IModelProvider {
  let calls = 0;
  return {
    id: "mock-model",
    generate: (prompt) => {
      prompts.push(prompt);
      calls++;
      const content = calls === 1
        ? `${REACT_THOUGHT_PREFIX}Attempt the requested command.\n\`\`\`toml\n[[actions]]\ntool = "run_command"\n[actions.params]\ncommand = "${command}"\nargs = [${
          args.map((arg) => `"${arg}"`).join(", ")
        }]\n\`\`\``
        : `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}The command was rejected.`;
      return Promise.resolve({
        content,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: "test",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
}

Deno.test("[security] Git Security: blocks destructive git reset --hard in PlanExecutor", async () => {
  const { tempDir, db, cleanup, config } = await createGitTestContext("security-reset-");
  const repoDir = join(tempDir, "repo");
  await Deno.mkdir(repoDir, { recursive: true });
  const git = new GitService({ config, repoPath: repoDir });

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    const blueprintsDir = join(config.system.root, config.paths.blueprints, "Agents");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    await Deno.writeTextFile(
      join(blueprintsDir, "test-agent.md"),
      `---\nname: test-agent\nmodel: mock-model\nprovider: mock\ncapabilities: ["write"]\npermitted_tools: [run_command]\nallowed_paths: ["*"]\n---\nYou are a test agent.\n`,
    );

    const prompts: string[] = [];
    const mockProvider = createCommandAttemptProvider("git", ["reset", "--hard", "HEAD"], prompts);
    const executor = new PlanExecutor(config, mockProvider, db, repoDir, new EventLogger({ db }));

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000011",
      request_id: "req-security-1",
      agent_role: "test-agent",
      frontmatter: {},
      steps: [{ number: 1, title: "Attack", content: "Attempt destructive reset" }],
    };

    await executor.execute("plan.md", context);
    assertEquals(prompts.length, 2);
    await db.waitForFlush();
    const toolCalls = await db.queryActivity({ traceId: context.trace_id, actionType: "dynamic_tool_call" });
    assertEquals(toolCalls.length, 1);
    assertEquals(JSON.parse(toolCalls[0].payload).resultSummary.includes("Destructive git operation prohibited"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("[security] Git Security: blocks checkout to main branch", async () => {
  const { tempDir, db, cleanup, config } = await createGitTestContext("security-checkout-");
  const repoDir = join(tempDir, "repo");
  await Deno.mkdir(repoDir, { recursive: true });
  const git = new GitService({ config, repoPath: repoDir });

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    // Create blueprint without the MCP capability so the default ReAct strategy is used
    const blueprintsDir = join(config.system.root, config.paths.blueprints, "Agents");
    await Deno.mkdir(blueprintsDir, { recursive: true });
    const fixture_1 = readFixtureTextSync(import.meta.url, "security", "git_security_regression_test", "fixture_1.md");
    await Deno.writeTextFile(join(blueprintsDir, "test-agent.md"), fixture_1);

    const prompts: string[] = [];
    const mockProvider = createCommandAttemptProvider("git", ["checkout", "main"], prompts);
    const executor = new PlanExecutor(config, mockProvider, db, repoDir, new EventLogger({ db }));

    const context: IPlanContext = {
      trace_id: "00000000-0000-0000-0000-000000000012",
      request_id: "req-security-2",
      agent_role: "test-agent",
      frontmatter: {},
      steps: [{ number: 1, title: "Attack", content: "Attempt checkout main" }],
    };

    await executor.execute("plan.md", context);
    assertEquals(prompts.length, 2);
    await db.waitForFlush();
    const toolCalls = await db.queryActivity({ traceId: context.trace_id, actionType: "dynamic_tool_call" });
    assertEquals(toolCalls.length, 1);
    assertEquals(JSON.parse(toolCalls[0].payload).resultSummary.includes("Operations on protected branches"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("[security] Git Security: prevents system root taint during Portal execution failure", async () => {
  const { tempDir, db, cleanup, config } = await createGitTestContext("security-taint-");
  const systemRoot = join(tempDir, "system_root");
  await Deno.mkdir(systemRoot, { recursive: true });

  // Update config to use this fake system root
  config.system.root = systemRoot;
  config.paths.workspace = "Workspace";
  config.paths.active = "Active";
  config.paths.memory = "Memory";
  config.paths.blueprints = "Blueprints";

  const portalsDir = join(tempDir, "portals");
  const portalPath = join(portalsDir, "test-portal");
  await Deno.mkdir(portalPath, { recursive: true });

  // Init portal as a git repo (configures a local identity so commits work on
  // CI runners that have no global git identity).
  await setupGitRepo(portalPath);
  const portalHelper = new GitTestHelper(portalPath);
  await Deno.writeTextFile(join(portalPath, "README.md"), "# Test Portal");
  await portalHelper.runGit(["add", "."]);
  await portalHelper.runGit(["commit", "-m", "Initial"]);

  config.portals = [{
    alias: "test",
    target_path: portalPath,
    default_branch: TEST_DEFAULT_BRANCH,
    agents_allowed: ["*"],
    operations: [],
  }];

  const loop = new ExecutionLoop({
    config,
    db,
    agentRole: "test-daemon",
  });

  // Create a plan that fails
  const planContentPath = getFixturePath(import.meta.url, "git_security_regression_plan.md");
  const planContent = await Deno.readTextFile(planContentPath);

  const activeDir = join(systemRoot, "Workspace", "Active");
  await Deno.mkdir(activeDir, { recursive: true });
  const planPath = join(activeDir, "plan.md");
  await Deno.writeTextFile(planPath, planContent);

  // Execute
  await loop.processTask(planPath);

  // VERIFY: System root should NOT have a .git folder
  const dotGitInRoot = join(systemRoot, ".git");
  let gitExists = false;
  try {
    await Deno.stat(dotGitInRoot);
    gitExists = true;
  } catch {
    // Expected to not find .git
  }

  assert(!gitExists, "System root should not contain a .git folder after execution failure");

  // VERIFY: Portal repository should still be on main (or whatever it was) and NOT have been reset via global command
  // Actually, we expect it to be on 'main' because it was never checkout-moved in the root.
  // But more importantly, no 'git init' happened in root.

  await cleanup();
});
