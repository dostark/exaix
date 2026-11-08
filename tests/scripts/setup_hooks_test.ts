/**
 * @module SetupHooksTest
 * @path tests/scripts/setup_hooks_test.ts
 * @description Integration test to verify git hook installation logic.
 */

import { assert, assertEquals, assertFalse, assertMatch, assertRejects, assertStringIncludes } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { fromFileUrl, join } from "@std/path";
import { defaultSandboxRoot } from "../../scripts/prune_scenario_sandboxes.ts";
import { installHooks } from "../../scripts/setup_hooks.ts";

// We won't import the logic directly as it's a main-only script usually,
// but we can test it by running it as a subprocess.

describe("scripts/setup_hooks.ts", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await Deno.makeTempDir();
  });

  afterEach(async () => {
    await Deno.remove(tmpDir, { recursive: true });
  });

  it("fix(hooks): installs executable hooks from a linked worktree", async () => {
    const repoDir = join(tmpDir, "repo");
    const worktreeDir = join(tmpDir, "worktree");
    const gitEnv = Deno.env.toObject();
    gitEnv.LD_LIBRARY_PATH = "";
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) {
      delete gitEnv[key];
    }
    await Deno.mkdir(repoDir);
    for (
      const args of [
        ["init"],
        ["-c", "user.name=Test User", "-c", "user.email=test@exaix.local", "commit", "--allow-empty", "-m", "fixture"],
        ["worktree", "add", "--detach", worktreeDir],
      ]
    ) {
      const result = await new Deno.Command("git", { args, cwd: repoDir, env: gitEnv, clearEnv: true }).output();
      assert(result.success, new TextDecoder().decode(result.stderr));
    }
    assert((await Deno.stat(join(worktreeDir, ".git"))).isFile);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-all", fromFileUrl(new URL("../../scripts/setup_hooks.ts", import.meta.url))],
      cwd: worktreeDir,
      env: gitEnv,
      clearEnv: true,
    }).output();
    assert(result.success, new TextDecoder().decode(result.stderr));
    for (const hook of ["pre-commit", "pre-push", "commit-msg", "pre-merge-commit", "pre-rebase"]) {
      const hookPath = join(repoDir, ".git", "hooks", hook);
      assertMatch(await Deno.readTextFile(hookPath), /^#!\/bin\/sh\n/);
      if (Deno.build.os !== "windows") {
        assertEquals((await Deno.stat(hookPath)).mode! & 0o111, 0o111);
      }
    }
  });

  it("fix(hooks): the authored install task can resolve Git hooks with scoped permissions", async () => {
    const config = JSON.parse(await Deno.readTextFile("deno.json"));
    const script = fromFileUrl(new URL("../../scripts/setup_hooks.ts", import.meta.url));
    const env = Deno.env.toObject();
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];
    env.LD_LIBRARY_PATH = "/fixture/library";
    const init = await new Deno.Command("git", { args: ["init"], cwd: tmpDir, env, clearEnv: true }).output();
    assert(init.success, new TextDecoder().decode(init.stderr));
    await Deno.writeTextFile(
      join(tmpDir, "deno.json"),
      JSON.stringify({
        imports: { "@std/path": config.imports["@std/path"] },
        tasks: { "hooks:install": config.tasks["hooks:install"].replace("scripts/setup_hooks.ts", script) },
      }),
    );
    const installed = await new Deno.Command(Deno.execPath(), {
      args: ["task", "hooks:install"],
      cwd: tmpDir,
      env,
      clearEnv: true,
    }).output();
    assert(installed.success, new TextDecoder().decode(installed.stderr));
    assertMatch(await Deno.readTextFile(join(tmpDir, ".git", "hooks", "pre-commit")), /^#!\/bin\/sh\n/);
  });

  it("installs pre-commit, pre-push, and commit-msg hooks", async () => {
    // Fake a .git/hooks directory
    const gitHooksDir = join(tmpDir, ".git", "hooks");
    await Deno.mkdir(gitHooksDir, { recursive: true });

    // For now, let's just check if the commit-msg hook exists after running
    // deno run -A scripts/setup_hooks.ts
    // (This would affect the ACTUAL repo, which might be okay for integration test).

    // A safer way: Check if deno.json has the task.
    const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
    assert(denoConfig.tasks["check:commit-msg"], "deno.json should have check:commit-msg task");
    assert(denoConfig.tasks["check:test-placement"], "deno.json should have check:test-placement task");

    const hookInstaller = await Deno.readTextFile("scripts/setup_hooks.ts");
    assertStringIncludes(
      hookInstaller,
      "deno task check:test-placement",
      "pre-commit hook should run test placement validation",
    );
    assertStringIncludes(
      hookInstaller,
      'deno test --allow-all --no-check "tests/**/*_security_test.ts"',
      "pre-push hook should select only the *_security_test.ts files (not load all of tests/)",
    );
    assert(
      !hookInstaller.includes("deno test --allow-all $TEST_FILES"),
      "pre-push hook should not run focused tests for changed files",
    );
    assertStringIncludes(
      hookInstaller,
      "Only .copilot/manifest.json generated_at changed; skipping amend.",
      "pre-push hook should ignore timestamp-only manifest drift",
    );
    assert(
      denoConfig.tasks["check:runtime-artifacts"],
      "deno.json should have check:runtime-artifacts task",
    );
    assertStringIncludes(
      hookInstaller,
      "deno task check:runtime-artifacts",
      "pre-commit hook should run the runtime-artifacts check (venv/, __pycache__/, node_modules/)",
    );
    assert(
      denoConfig.tasks["check:scenario-declarative"],
      "deno.json should have check:scenario-declarative task",
    );
    assertStringIncludes(
      hookInstaller,
      "deno task check:scenario-declarative -- --fail",
      "pre-commit hook should run the scenario declarative-purity check (rejects procedural shell steps in scenario YAML)",
    );
    assert(
      denoConfig.tasks["check:skill-duplication"],
      "deno.json should have check:skill-duplication task",
    );
    assertStringIncludes(
      hookInstaller,
      "deno task check:skill-duplication",
      "pre-commit hook should run the fast skill-instruction duplication check",
    );
    assertStringIncludes(
      hookInstaller,
      "deno task check:security-test-naming",
      "pre-commit hook should run the security-test naming gate",
    );
  });

  it("clears git-hook-injected GIT_* env vars before running the pre-push security suite", async () => {
    // git sets GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/etc. in a hook's own environment; left
    // unset, these leak into `deno test`'s spawned children and make raw `git` commands in
    // tests with their own temp repo operate against THIS repo's real .git instead.
    const hookInstaller = await Deno.readTextFile("scripts/setup_hooks.ts");
    const securityTestLine = 'deno test --allow-all --no-check "tests/**/*_security_test.ts"';
    const idx = hookInstaller.indexOf(securityTestLine);
    assert(idx !== -1, "pre-push hook must still invoke the security regression suite");
    const lineStart = hookInstaller.lastIndexOf("\n", idx) + 1;
    const fullLine = hookInstaller.slice(lineStart, hookInstaller.indexOf("\n", idx));
    for (const gitVar of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
      assertStringIncludes(
        fullLine,
        `-u ${gitVar}`,
        `pre-push hook's security test invocation must clear ${gitVar} to avoid leaking into the test's own git subprocesses (got: ${fullLine})`,
      );
    }
  });
});

describe("pre-push submodule check", () => {
  it("fix(hooks): runs every git call inside a submodule with the hook-injected GIT_* variables cleared", async () => {
    // A linked worktree exports GIT_DIR to the hook. A bare `git status` in the submodule
    // then reports the parent tree. A clean submodule looks dirty.
    const hookInstaller = await Deno.readTextFile("scripts/setup_hooks.ts");
    const start = hookInstaller.indexOf('cd "$SUBMODULE_NAME" || exit 1');
    const end = hookInstaller.indexOf("cd - >/dev/null", start);
    assert(start !== -1 && end !== -1, "the pre-push submodule block must still enter and leave the submodule");
    const block = hookInstaller.slice(start, end);
    const bareGit = block.split("\n").filter((line) => /\bgit (status|rev-parse|rev-list|push)\b/.test(line));
    assertEquals(bareGit, [], "every git call in the submodule block must go through the helper that clears GIT_*");
    const helper = hookInstaller.slice(hookInstaller.indexOf("submodule_git()"), start);
    for (const gitVar of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
      assertStringIncludes(helper, `-u ${gitVar}`, `the submodule git helper must clear ${gitVar}`);
    }
  });
});

describe("staged docs gitlink commits", () => {
  async function withHookFixture(
    body: (dir: string, git: (args: string[]) => Promise<string>) => Promise<void>,
  ): Promise<void> {
    const dir = await Deno.makeTempDir({ prefix: "docs_gitlink_hook_" });
    const env = Deno.env.toObject();
    env.LD_LIBRARY_PATH = "";
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];
    const git = async (args: string[]): Promise<string> => {
      const result = await new Deno.Command("git", { args, cwd: dir, env, clearEnv: true }).output();
      assert(result.success, new TextDecoder().decode(result.stderr));
      return new TextDecoder().decode(result.stdout).trim();
    };
    try {
      await git(["-c", "init.defaultBranch=hook-fixture", "init"]);
      await git(["config", "user.name", "Hook Test"]);
      await git(["config", "user.email", "hook@exaix.local"]);
      await git(["config", "commit.gpgsign", "false"]);
      await git(["commit", "--allow-empty", "-m", "first"]);
      const first = await new Deno.Command("git", {
        args: ["rev-parse", "HEAD"],
        cwd: dir,
        env,
        clearEnv: true,
      }).output();
      const firstSha = new TextDecoder().decode(first.stdout).trim();
      await git(["commit", "--allow-empty", "-m", "second"]);
      await git(["update-index", "--add", "--cacheinfo", `160000,${firstSha},exaix-dev-docs`]);
      await git(["update-index", "--add", "--cacheinfo", `160000,${firstSha},unslop-ts`]);
      await git(["update-index", "--add", "--cacheinfo", `160000,${firstSha},exaix-team`]);
      await Deno.writeTextFile(join(dir, "tracked.ts"), "export const value = 0;\n");
      await Deno.writeTextFile(
        join(dir, ".gitmodules"),
        '[submodule "engine"]\n\tpath = unslop-ts\n\turl = ./engine\n',
      );
      await git(["add", "tracked.ts", ".gitmodules"]);
      await git(["commit", "-m", "baseline links"]);
      const installed = await new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", fromFileUrl(new URL("../../scripts/setup_hooks.ts", import.meta.url))],
        cwd: dir,
        env,
        clearEnv: true,
      }).output();
      assert(installed.success, new TextDecoder().decode(installed.stderr));
      await Deno.mkdir(join(dir, "bin"));
      await Deno.writeTextFile(
        join(dir, "bin", "deno"),
        [
          "#!/bin/sh",
          'printf \'%s\\n\' "$*" >> "$EXAIX_HOOK_TEST_LOG"',
          'if [ "$1" = "task" ] && [ "$2" = "$EXAIX_HOOK_FAIL_TASK" ]; then exit 1; fi',
          "exit 0",
          "",
        ].join("\n"),
      );
      await Deno.chmod(join(dir, "bin", "deno"), 0o755);
      env.PATH = `${join(dir, "bin")}:${env.PATH}`;
      env.EXAIX_HOOK_TEST_LOG = join(dir, "calls.log");
      env.EXAIX_HOOK_FAIL_TASK = "check:complexity";
      await body(dir, git);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }

  async function stagePointer(git: (args: string[]) => Promise<string>, path: string): Promise<void> {
    const sha = await git(["rev-parse", "HEAD"]);
    await git(["update-index", "--cacheinfo", `160000,${sha},${path}`]);
  }

  async function commitFixture(dir: string, failTask = "check:complexity"): Promise<boolean> {
    const env = Deno.env.toObject();
    env.LD_LIBRARY_PATH = "";
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];
    env.PATH = `${join(dir, "bin")}:${env.PATH}`;
    env.EXAIX_HOOK_TEST_LOG = join(dir, "calls.log");
    env.EXAIX_HOOK_FAIL_TASK = failTask;
    delete env.HOOK_BYPASS_MAIN;
    return (await new Deno.Command("git", {
      args: ["commit", "-m", "fixture change"],
      cwd: dir,
      env,
      clearEnv: true,
    }).output()).success;
  }

  it("fix(hooks): a docs gitlink bump skips code gates and still validates the message", async () => {
    await withHookFixture(async (dir, git) => {
      await stagePointer(git, "exaix-dev-docs");
      assertEquals(await commitFixture(dir), true);
      const calls = await Deno.readTextFile(join(dir, "calls.log"));
      assertStringIncludes(calls, "task check:commit-msg");
      assertFalse(calls.includes("task check:complexity"), calls);
      assertFalse(calls.includes("task lint"), calls);
      assertFalse(calls.includes("task fmt:check"), calls);
    });
  });

  it("fix(hooks): docs pointer commits still reject invalid commit messages", async () => {
    await withHookFixture(async (dir, git) => {
      await stagePointer(git, "exaix-dev-docs");
      assertEquals(await commitFixture(dir, "check:commit-msg"), false);
      const calls = await Deno.readTextFile(join(dir, "calls.log"));
      assertStringIncludes(calls, "task check:commit-msg");
      assertFalse(calls.includes("task check:complexity"), calls);
    });
  });

  it("fix(hooks): a docs pointer commit cannot bypass the main branch guard", async () => {
    await withHookFixture(async (dir, git) => {
      await git(["branch", "-M", "main"]);
      await stagePointer(git, "exaix-dev-docs");
      assertEquals(await commitFixture(dir), false);
      await assertRejects(() => Deno.stat(join(dir, "calls.log")), Deno.errors.NotFound);
    });
  });

  it("fix(hooks): replacing the docs gitlink with a regular file keeps full checks", async () => {
    await withHookFixture(async (dir, git) => {
      await Deno.writeTextFile(join(dir, "exaix-dev-docs"), "regular file\n");
      await git(["add", "exaix-dev-docs"]);
      assertEquals(await commitFixture(dir), false);
      assertStringIncludes(await Deno.readTextFile(join(dir, "calls.log")), "task check:complexity");
    });
  });

  it("fix(hooks): deleting the docs gitlink keeps full checks", async () => {
    await withHookFixture(async (dir, git) => {
      await git(["rm", "--cached", "exaix-dev-docs"]);
      assertEquals(await commitFixture(dir), false);
      assertStringIncludes(await Deno.readTextFile(join(dir, "calls.log")), "task check:complexity");
    });
  });

  for (const path of ["unslop-ts", "exaix-team"]) {
    it(`fix(hooks): a ${path} gitlink bump still enforces code gates`, async () => {
      await withHookFixture(async (dir, git) => {
        await stagePointer(git, path);
        assertEquals(await commitFixture(dir), false);
        assertStringIncludes(await Deno.readTextFile(join(dir, "calls.log")), "task check:complexity");
      });
    });
  }

  it("fix(hooks): mixed docs and source changes still enforce code gates", async () => {
    await withHookFixture(async (dir, git) => {
      await stagePointer(git, "exaix-dev-docs");
      await Deno.writeTextFile(join(dir, "code.ts"), "export const value = 1;\n");
      await git(["add", "code.ts"]);
      assertEquals(await commitFixture(dir), false);
      assertStringIncludes(await Deno.readTextFile(join(dir, "calls.log")), "task check:complexity");
    });
  });

  it("fix(hooks): unstaged source changes do not turn a docs pointer commit into a source commit", async () => {
    await withHookFixture(async (dir, git) => {
      await stagePointer(git, "exaix-dev-docs");
      await Deno.writeTextFile(join(dir, "tracked.ts"), "export const value = 1;\n");
      assertEquals(await commitFixture(dir), true);
    });
  });

  it("fix(hooks): docs and source pointers remain checked even when Git hides submodules by default", async () => {
    await withHookFixture(async (dir, git) => {
      await stagePointer(git, "exaix-dev-docs");
      await stagePointer(git, "unslop-ts");
      await git(["config", "submodule.engine.ignore", "all"]);
      assertEquals(await commitFixture(dir), false);
      assertStringIncludes(await Deno.readTextFile(join(dir, "calls.log")), "task check:complexity");
    });
  });
});

describe("event coverage visibility via the real pre-commit hook (real subprocess git commit)", () => {
  const REPO_ROOT = Deno.cwd();

  // Read the installed hook so this test follows the real pre-commit command.
  // Use absolute `deno run` because task CWD discovery escapes the scratch repo.
  // Install hooks because a CI checkout lacks the local hook file.
  async function extractEventCoverageHook(): Promise<string> {
    await installHooks();
    const proc = await new Deno.Command("git", {
      args: ["rev-parse", "--git-path", "hooks"],
      cwd: REPO_ROOT,
      env: { LD_LIBRARY_PATH: "" },
    }).output();
    if (!proc.success) {
      throw new Error(`git rev-parse --git-path hooks failed: ${new TextDecoder().decode(proc.stderr)}`);
    }
    const hooksDir = new TextDecoder().decode(proc.stdout).trim();
    const hookContent = await Deno.readTextFile(join(hooksDir, "pre-commit"));
    const match = hookContent.match(/# \d+\. Event Coverage Visibility Check[\s\S]*?\nfi\n/);
    assert(match, "event-coverage block not found in .git/hooks/pre-commit — has it been renamed or removed?");
    const scriptPath = join(REPO_ROOT, "scripts", "check_event_coverage.ts");
    return match![0].replace(
      "deno task check:event-coverage:staged:visible",
      `deno run --allow-read --allow-env --allow-run=git ${scriptPath} --staged --fail-on-tagged`,
    );
  }

  /** Remove any scratch repos left over from earlier interrupted test runs. */
  async function sweepStaleScratch(sandboxRoot: string): Promise<void> {
    for (const entry of Deno.readDirSync(sandboxRoot)) {
      if (entry.isDirectory && entry.name.startsWith(SCRATCH_PREFIX)) {
        await Deno.remove(join(sandboxRoot, entry.name), { recursive: true });
      }
    }
  }

  // Scratch git repo nested under the sibling-of-repo sandbox root (the same convention the
  // scenario runner and scripts/prune_scenario_sandboxes.ts use), kept OUT of the repo tree so
  // test scratch can never pollute the tracked checkout.
  const SCRATCH_PREFIX = "precommit-hook-scratch-";

  async function setupScratchRepo(fixtureContent: string): Promise<string> {
    const sandboxRoot = defaultSandboxRoot();
    await Deno.mkdir(sandboxRoot, { recursive: true });
    await sweepStaleScratch(sandboxRoot);
    const tmpDir = await Deno.makeTempDir({ dir: sandboxRoot, prefix: SCRATCH_PREFIX });
    const gitEnv = { LD_LIBRARY_PATH: "" };
    try {
      await new Deno.Command("git", { args: ["init"], cwd: tmpDir, env: gitEnv }).output();
      await new Deno.Command("git", { args: ["config", "user.name", "Test User"], cwd: tmpDir, env: gitEnv }).output();
      await new Deno.Command("git", { args: ["config", "user.email", "test@exaix.local"], cwd: tmpDir, env: gitEnv })
        .output();

      const hooksDir = join(tmpDir, ".git", "hooks");
      const eventCoverageBlock = await extractEventCoverageHook();
      const hookPath = join(hooksDir, "pre-commit");
      await Deno.writeTextFile(hookPath, `#!/bin/sh\n${eventCoverageBlock}\necho "event-coverage hook passed"\n`);
      await Deno.chmod(hookPath, 0o755);

      const fixtureDir = join(tmpDir, "packages", "fake_visible_fixture", "src");
      await Deno.mkdir(fixtureDir, { recursive: true });
      await Deno.writeTextFile(join(fixtureDir, "gap_class.ts"), fixtureContent);
      await new Deno.Command("git", { args: ["add", "."], cwd: tmpDir, env: gitEnv }).output();

      return tmpDir;
    } catch (error) {
      // A failure here (e.g. the real hook cannot be read) must not leak scratch state.
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
      throw error;
    }
  }

  async function attemptCommit(tmpDir: string): Promise<{ success: boolean; stderr: string }> {
    const result = await new Deno.Command("git", {
      args: ["commit", "-m", "hook fixture commit"],
      cwd: tmpDir,
      env: { LD_LIBRARY_PATH: "" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    return { success: result.success, stderr: new TextDecoder().decode(result.stderr) };
  }

  it("[integration] rejects a real git commit staging a @visible class with no logger dependency", async () => {
    const fixture = `/** @visible */\nexport class GapClass {\n  doSomething(): void {\n    this.value = 1;\n  }\n}\n`;
    const tmpDir = await setupScratchRepo(fixture);
    try {
      const { success, stderr } = await attemptCommit(tmpDir);
      assertEquals(success, false, `expected the real pre-commit hook to reject this commit, stderr was: ${stderr}`);
      assert(
        stderr.includes("event-coverage") || stderr.includes("@visible-tagged coverage gap"),
        `expected check:event-coverage rejection text in stderr, got: ${stderr}`,
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  it("[integration] a real git commit staging a @visible class with full coverage succeeds", async () => {
    const fixture =
      `import type { IEventLogger } from "@exaix/core/logger";\nimport { DomainEventType } from "@exaix/core/events";\n\n/** @visible */\nexport class CoveredClass {\n  constructor(private logger: IEventLogger) {}\n  doSomething(): void {\n    this.value = 1;\n    this.logger.info(DomainEventType.FlowStepExecuted, "target", {});\n  }\n}\n`;
    const tmpDir = await setupScratchRepo(fixture);
    try {
      const { success, stderr } = await attemptCommit(tmpDir);
      assertEquals(success, true, `expected the real pre-commit hook to accept this commit, stderr was: ${stderr}`);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  it("[regression] a real git commit staging an untagged class with a heuristic-only finding still succeeds", async () => {
    const fixture =
      `import type { IEventLogger } from "@exaix/core/logger";\n\nexport class UntaggedGapClass {\n  constructor(private logger?: IEventLogger) {}\n  doSomething(): void {\n    this.value = 1;\n  }\n}\n`;
    const tmpDir = await setupScratchRepo(fixture);
    try {
      const { success, stderr } = await attemptCommit(tmpDir);
      assertEquals(
        success,
        true,
        `expected the real pre-commit hook to accept this commit (untagged findings are advisory-only, never blocking), stderr was: ${stderr}`,
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });
});
