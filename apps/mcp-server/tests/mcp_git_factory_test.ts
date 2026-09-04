/**
 * @module McpGitFactoryTest
 * @path apps/mcp-server/tests/mcp_git_factory_test.ts
 * @related-files [apps/mcp-server/main.ts, packages/core/src/types/i_git_service.ts]
 * @architectural-layer MCP
 * @description Verifies the standalone MCP server's buildServerContext exposes a
 *   gitServiceFactory when EXA_MCP_REAL_GIT=1 and that the factory produces
 *   working IGitService instances. Phase 156 Step 1 planned test.
 */
import { assert, assertEquals } from "@std/assert";
import { ConfigService } from "@exaix/core/config";
import { buildServerContext } from "../main.ts";

function writeMinimalConfig(root: string): string {
  const configPath = `${root}/exa.config.toml`;
  Deno.writeTextFileSync(
    configPath,
    [
      "[system]",
      `root = "${root}"`,
      'version = "1.0.0"',
      'log_level = "info"',
      "",
      "[[portals]]",
      'alias = "probe"',
      `target_path = "${root}/portal"`,
      'agents_allowed = ["test-role"]',
      'operations = ["read", "write", "git"]',
      "",
    ].join("\n"),
  );
  return configPath;
}

Deno.test("buildServerContext: EXA_MCP_REAL_GIT=1 exposes a gitServiceFactory", () => {
  const root = Deno.makeTempDirSync({ prefix: "mcp-git-factory-" });
  try {
    Deno.mkdirSync(`${root}/portal`, { recursive: true });
    const configService = new ConfigService(writeMinimalConfig(root));
    const prevEnv = Deno.env.get("EXA_MCP_REAL_GIT");
    Deno.env.set("EXA_MCP_REAL_GIT", "1");
    const { context, dispose } = buildServerContext(configService);
    try {
      assert(context.gitServiceFactory !== undefined, "gitServiceFactory must be wired when EXA_MCP_REAL_GIT=1");
      assertEquals(typeof context.gitServiceFactory!.createGitService, "function");
      // The factory should produce a real IGitService instance
      const service = context.gitServiceFactory!.createGitService(root, "trace-1");
      assert(service !== undefined, "createGitService must return an instance");
      assertEquals(typeof service.runGitCommand, "function");
      assertEquals(typeof service.validateArgs, "function");
      assertEquals(typeof service.getCurrentBranch, "function");
    } finally {
      if (prevEnv !== undefined) Deno.env.set("EXA_MCP_REAL_GIT", prevEnv);
      else Deno.env.delete("EXA_MCP_REAL_GIT");
      dispose();
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("buildServerContext: without EXA_MCP_REAL_GIT, gitServiceFactory returns stub", () => {
  const root = Deno.makeTempDirSync({ prefix: "mcp-git-stub-" });
  try {
    Deno.mkdirSync(`${root}/portal`, { recursive: true });
    const configService = new ConfigService(writeMinimalConfig(root));
    const { context, dispose } = buildServerContext(configService);
    try {
      assert(context.gitServiceFactory !== undefined, "gitServiceFactory must be present (stub factory)");
      const stubService = context.gitServiceFactory!.createGitService(root, "trace-1");
      assertEquals(typeof stubService.runGitCommand, "function");
      // context.git should still be present (stub)
      assert(context.git !== undefined, "context.git must still be present (stub)");
      assertEquals(typeof context.git.getCurrentBranch, "function");
    } finally {
      dispose();
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("buildServerContext: factory-created GitService runs real git commands against a repo", async () => {
  const root = Deno.makeTempDirSync({ prefix: "mcp-git-real-" });
  try {
    // Create a real git repo in the portal directory
    const portalDir = `${root}/portal`;
    Deno.mkdirSync(portalDir, { recursive: true });
    const gitInit = new Deno.Command("git", {
      args: ["init", "-b", "main"],
      cwd: portalDir,
    });
    await gitInit.output();
    const gitConfig = new Deno.Command("git", {
      args: ["config", "user.email", "test@test.com"],
      cwd: portalDir,
    });
    await gitConfig.output();
    const gitConfig2 = new Deno.Command("git", {
      args: ["config", "user.name", "Tester"],
      cwd: portalDir,
    });
    await gitConfig2.output();
    // Commit something so the repo has history
    Deno.writeTextFileSync(`${portalDir}/readme.txt`, "hello");
    const gitAdd = new Deno.Command("git", { args: ["add", "-A"], cwd: portalDir });
    await gitAdd.output();
    const gitCommit = new Deno.Command("git", {
      args: ["commit", "-m", "init"],
      cwd: portalDir,
    });
    await gitCommit.output();

    const configService = new ConfigService(writeMinimalConfig(root));
    const prevEnv = Deno.env.get("EXA_MCP_REAL_GIT");
    Deno.env.set("EXA_MCP_REAL_GIT", "1");
    const { context, dispose } = buildServerContext(configService);
    try {
      const service = context.gitServiceFactory!.createGitService(portalDir, "trace-1");
      // git_status should return clean status
      const statusResult = await service.runGitCommand(["status"]);
      assertEquals(statusResult.exitCode, 0);
      assert(statusResult.output.includes("nothing to commit"), "status should report clean tree");

      // git_log should show the initial commit
      const logResult = await service.runGitCommand(["log", "--oneline"]);
      assertEquals(logResult.exitCode, 0);
      assert(logResult.output.includes("init"), "log should show initial commit");

      // validateArgs should reject dangerous options
      const validation = service.validateArgs(["--git-dir=/etc"]);
      assertEquals(validation.valid, false);
      assert(validation.reason !== undefined, "should have a reason for rejection");
    } finally {
      if (prevEnv !== undefined) Deno.env.set("EXA_MCP_REAL_GIT", prevEnv);
      else Deno.env.delete("EXA_MCP_REAL_GIT");
      dispose();
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});
