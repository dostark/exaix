/**
 * @module SetupHooksTest
 * @path tests/scripts/setup_hooks_test.ts
 * @description Integration test to verify git hook installation logic.
 */

import { assert, assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { defaultSandboxRoot } from "../../scripts/prune_scenario_sandboxes.ts";

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
    assert(
      hookInstaller.includes("deno task check:test-placement"),
      "pre-commit hook should run test placement validation",
    );
    assert(
      hookInstaller.includes('deno test --allow-all --filter "[security]" tests/'),
      "pre-push hook should run only the security regression suite",
    );
    assert(
      !hookInstaller.includes("deno test --allow-all $TEST_FILES"),
      "pre-push hook should not run focused tests for changed files",
    );
    assert(
      hookInstaller.includes("Only .copilot/manifest.json generated_at changed; skipping amend."),
      "pre-push hook should ignore timestamp-only manifest drift",
    );
    assert(
      denoConfig.tasks["check:runtime-artifacts"],
      "deno.json should have check:runtime-artifacts task",
    );
    assert(
      hookInstaller.includes("deno task check:runtime-artifacts"),
      "pre-commit hook should run the runtime-artifacts check (venv/, __pycache__/, node_modules/)",
    );
  });

  it("clears git-hook-injected GIT_* env vars before running the pre-push security suite", async () => {
    // git sets GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/etc. in a hook's own environment; left
    // unset, these leak into `deno test`'s spawned children and make raw `git` commands in
    // tests with their own temp repo operate against THIS repo's real .git instead.
    const hookInstaller = await Deno.readTextFile("scripts/setup_hooks.ts");
    const securityTestLine = 'deno test --allow-all --filter "[security]" tests/';
    const idx = hookInstaller.indexOf(securityTestLine);
    assert(idx !== -1, "pre-push hook must still invoke the security regression suite");
    const lineStart = hookInstaller.lastIndexOf("\n", idx) + 1;
    const fullLine = hookInstaller.slice(lineStart, hookInstaller.indexOf("\n", idx));
    for (const gitVar of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
      assert(
        fullLine.includes(`-u ${gitVar}`),
        `pre-push hook's security test invocation must clear ${gitVar} to avoid leaking into the test's own git subprocesses (got: ${fullLine})`,
      );
    }
  });
});

describe("event coverage visibility via the real pre-commit hook (real subprocess git commit)", () => {
  const REPO_ROOT = Deno.cwd();

  // Extracts the event-coverage block from the REAL installed pre-commit hook so this test
  // never drifts from what it actually runs. `deno task X` redirects CWD by walking up to find
  // deno.json, so it's swapped for absolute `deno run`, which correctly scopes to the scratch repo.
  async function extractEventCoverageHook(): Promise<string> {
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
