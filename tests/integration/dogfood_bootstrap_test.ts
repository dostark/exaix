/**
 * @module DogfoodBootstrapTest
 * @path tests/integration/dogfood_bootstrap_test.ts
 * @description Integration test for the dogfood bootstrap script
 */

import { assert, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const BOOTSTRAP_SCRIPT = "scripts/dogfood_bootstrap.ts";

async function runScript(
  args: string[],
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "-A", BOOTSTRAP_SCRIPT, ...args],
    env: { ...env },
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

function createFakeGitRepo(dir: string): void {
  Deno.mkdirSync(join(dir, ".git"), { recursive: true });
  Deno.writeTextFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
}

Deno.test("dogfood bootstrap fails without argument", async () => {
  const result = await runScript([]);
  assert(result.code !== 0, "should exit non-zero without arguments");
  assertStringIncludes(result.stderr, "Usage");
});

Deno.test("dogfood bootstrap fails on non-git directory", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "dogfood-bootstrap-test-" });
  try {
    const result = await runScript([join(tempDir, "worktree")], {
      DOGFOOD_BOOTSTRAP_TEST: "1",
      TEST_GIT_REPO: tempDir,
    });
    assert(result.code !== 0, "should exit non-zero on non-git directory");
    assertStringIncludes(result.stderr, "Not a git repository");
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

Deno.test("dogfood bootstrap validates existing path", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "dogfood-bootstrap-test-" });
  try {
    createFakeGitRepo(tempDir);
    // Path already exists (tempDir itself)
    const result = await runScript([tempDir], {
      DOGFOOD_BOOTSTRAP_TEST: "1",
      TEST_GIT_REPO: tempDir,
    });
    assert(result.code !== 0, "should exit non-zero when worktree path exists");
    assertStringIncludes(result.stderr, "already exists");
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

Deno.test("dogfood bootstrap replaces __WORKTREE_PATH__ in config", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "dogfood-bootstrap-test-" });
  const worktreePath = join(tempDir, "worktree");

  try {
    createFakeGitRepo(tempDir);

    // Copy the real dogfood config to the test repo's configs/ dir
    const configsDir = join(tempDir, "configs");
    Deno.mkdirSync(configsDir, { recursive: true });
    const realConfig = Deno.readTextFileSync("configs/dogfood.toml");
    Deno.writeTextFileSync(join(configsDir, "dogfood.toml"), realConfig);

    const result = await runScript([worktreePath], {
      DOGFOOD_BOOTSTRAP_TEST: "1",
      TEST_GIT_REPO: tempDir,
      OVERRIDE_CONFIG_PATH: join(configsDir, "dogfood.toml"),
    });

    assert(result.code === 0, `bootstrap should succeed: ${result.stderr}`);

    // Verify __WORKTREE_PATH__ was replaced in the config
    const configContent = Deno.readTextFileSync(join(configsDir, "dogfood.toml"));
    assert(!configContent.includes("__WORKTREE_PATH__"), "placeholder should be replaced");
    assertStringIncludes(configContent, worktreePath);
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
});
