/**
 * @module PortalFixtureStagingTest
 * @path tests/scenario_framework/tests/unit/portal_fixture_staging_test.ts
 * @description Unit test for the runner's fixture-portal staging (resetAndStageFixturePortal):
 * a declared fixture portal is clean-staged into a shared sandbox — the prior target, stale
 * execution worktrees, and stale symlink are removed before the fixture copy, and a git repo is
 * initialized when git_init is set. This is the framework-level isolation guarantee that keeps
 * one scenario's/cell's changes (or its solution) from leaking into the next run.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { resetAndStageFixturePortal } from "../../runner/synthetic_runner.ts";

function fixturePortal(overrides: Partial<Parameters<typeof resetAndStageFixturePortal>[0]> = {}) {
  return {
    alias: "todo-app",
    source_path: "/fixtures/todo_app_async_bug",
    target_path: "/workspace/todo-app",
    git_init: true,
    ...overrides,
  };
}

Deno.test({
  name: "[scenario-framework] fixture staging removes prior target, worktrees, and stale symlink",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.makeTempDir({ prefix: "exaix-fixture-stage-" });
    const workspaceRoot = join(root, "workspace");
    const source = join(root, "fixture-src");
    const target = join(workspaceRoot, "todo-app");

    // Prior-scenario residue that must NOT survive the reset:
    await ensureDir(join(target, "src"));
    await Deno.writeTextFile(join(target, "src", "stale.ts"), "// previous scenario solution");
    await Deno.writeTextFile(join(target, "stale-root.txt"), "leftover");
    await ensureDir(join(target, ".git")); // stale repo metadata
    await ensureDir(join(workspaceRoot, ".exa", "worktrees", "todo-app", "stale-trace"));
    await Deno.writeTextFile(join(workspaceRoot, ".exa", "worktrees", "todo-app", "stale-trace", "plan.md"), "old");
    await ensureDir(join(workspaceRoot, "Portals"));
    await Deno.symlink(target, join(workspaceRoot, "Portals", "todo-app"));

    // Fresh fixture:
    await ensureDir(join(source, "src"));
    await Deno.writeTextFile(join(source, "src", "business_logic.ts"), "// fresh fixture");
    await Deno.writeTextFile(join(source, "README.md"), "# fixture");

    try {
      await resetAndStageFixturePortal(
        fixturePortal({ target_path: target, source_path: source }),
        source,
        target,
        workspaceRoot,
      );

      assertEquals((await Deno.stat(join(target, "src", "business_logic.ts"))).isFile, true, "fixture copied");
      assert((await Deno.lstat(join(target, "src", "stale.ts")).catch(() => null)) === null, "prior source removed");
      assert((await Deno.lstat(join(target, "stale-root.txt")).catch(() => null)) === null, "prior root file removed");
      assert(
        (await Deno.lstat(join(workspaceRoot, "Portals", "todo-app")).catch(() => null)) === null,
        "stale portal symlink removed",
      );
      assert(
        (await Deno.stat(join(workspaceRoot, ".exa", "worktrees", "todo-app")).catch(() => null)) === null,
        "stale worktrees removed",
      );

      const gitLog = await new Deno.Command("git", {
        args: ["-C", target, "log", "--oneline"],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(gitLog.success, true, "git repo initialized");
      const log = new TextDecoder().decode(gitLog.stdout);
      assert(log.includes("init todo-app fixture"), `expected init commit, got: ${log.trim()}`);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name: "[scenario-framework] fixture staging without git_init copies but does not git-init",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.makeTempDir({ prefix: "exaix-fixture-stage-" });
    const workspaceRoot = join(root, "workspace");
    const source = join(root, "fixture-src");
    const target = join(workspaceRoot, "todo-app");
    await ensureDir(join(source, "src"));
    await Deno.writeTextFile(join(source, "src", "x.ts"), "x");
    await ensureDir(target); // prior state to clear

    try {
      await resetAndStageFixturePortal(
        fixturePortal({ target_path: target, source_path: source, git_init: false }),
        source,
        target,
        workspaceRoot,
      );
      assertEquals((await Deno.stat(join(target, "src", "x.ts"))).isFile, true, "fixture copied");
      assert(
        (await Deno.lstat(join(target, ".git")).catch(() => null)) === null,
        "no git repo when git_init is unset",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});
