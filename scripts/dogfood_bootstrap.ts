#!/usr/bin/env -S deno run -A
/**
 * @module DogfoodBootstrap
 * @path scripts/dogfood_bootstrap.ts
 * @description Bootstraps a dogfooding worktree: creates a git worktree, registers
 *   the portal, and waits for portal knowledge.
 *
 * Usage:
 *   deno run -A scripts/dogfood_bootstrap.ts <worktree_path>
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), ".."));
const CONFIG_PATH = Deno.env.get("OVERRIDE_CONFIG_PATH") || join(REPO_ROOT, "configs/dogfood.toml");
const EXACTL_CMD = ["deno", "run", "-A", join(REPO_ROOT, "apps/exactl/main.ts")];
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

async function runCommand(cmd: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await proc.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

async function main() {
  const args = Deno.args;
  const isTestMode = Deno.env.get("DOGFOOD_BOOTSTRAP_TEST") === "1";
  const testGitRepo = Deno.env.get("TEST_GIT_REPO");

  if (args.length < 1) {
    console.error("Usage: dogfood_bootstrap.ts <worktree_path>");
    Deno.exit(1);
  }

  let worktreePath = args[0];
  if (!worktreePath.startsWith("/")) {
    worktreePath = resolve(Deno.cwd(), worktreePath);
  }

  // Validate the worktree path does not already exist
  try {
    await Deno.stat(worktreePath);
    console.error(`Error: Path already exists: ${worktreePath}`);
    Deno.exit(1);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      console.error(`Error checking worktree path: ${e}`);
      Deno.exit(1);
    }
  }

  // Determine git repo root
  const gitRepoRoot = (isTestMode && testGitRepo) ? testGitRepo : REPO_ROOT;

  // Validate repo root
  const gitDir = join(gitRepoRoot, ".git");
  try {
    const stat = await Deno.stat(gitDir);
    if (!stat.isDirectory && !stat.isFile) {
      console.error("Error: Not a git repository (no .git directory found)");
      Deno.exit(1);
    }
  } catch {
    console.error("Error: Not a git repository (no .git directory found)");
    Deno.exit(1);
  }

  if (!isTestMode) {
    // 1. Create git worktree
    console.log(`Creating git worktree at: ${worktreePath}`);
    const wtResult = await runCommand(["git", "worktree", "add", "--force", worktreePath, "HEAD"], gitRepoRoot);
    if (wtResult.code !== 0) {
      console.error(`Failed to create worktree: ${wtResult.stderr.trim()}`);
      Deno.exit(1);
    }
  }

  // 2. Replace __WORKTREE_PATH__ in config
  console.log("Updating config with worktree path...");
  const configContent = Deno.readTextFileSync(CONFIG_PATH);
  const updated = configContent.replace(/__WORKTREE_PATH__/g, worktreePath);
  Deno.writeTextFileSync(CONFIG_PATH, updated);

  // 3. Register portal (skip in test mode)
  if (!isTestMode) {
    console.log("Registering portal exaix-self...");
    const portalResult = await runCommand([...EXACTL_CMD, "portal", "add", worktreePath, "exaix-self"]);
    if (portalResult.code !== 0) {
      console.error(`Failed to register portal: ${portalResult.stderr.trim()}`);
      Deno.exit(1);
    }

    // 4. Wait for portal knowledge
    console.log("Waiting for portal knowledge...");
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let knowledgeReady = false;
    while (Date.now() < deadline) {
      const knResult = await runCommand([...EXACTL_CMD, "portal", "knowledge", "exaix-self", "--json"]);
      if (knResult.code === 0 && knResult.stdout.trim().length > 0 && knResult.stdout.trim() !== "{}") {
        knowledgeReady = true;
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (!knowledgeReady) {
      console.error("Warning: Portal knowledge not generated within timeout.");
    } else {
      console.log("Portal knowledge ready.");
    }
  }

  console.log("\nBootstrap complete!");
  console.log(`  Worktree: ${worktreePath}`);
  if (!isTestMode) {
    console.log("\nNext steps:");
    console.log("  deno task dogfood");
    console.log("  # Write a request to Workspace/Requests/");
  }
}

if (import.meta.main) {
  main();
}
