#!/usr/bin/env -S deno run -A
/**
 * @module DogfoodBootstrap
 * @path scripts/dogfood_bootstrap.ts
 * @description Bootstraps a dogfooding sandbox by reusing existing deployment
 *   infrastructure (deploy_workspace.ts, migrate_db.ts). Creates an external
 *   sandbox directory, deploys a workspace, creates a git worktree, registers
 *   it as a portal, and replaces sentinel values in the dogfood config.
 *
 * Usage:
 *   deno run -A scripts/dogfood_bootstrap.ts \
 *     --dir ~/exa-dogfood \
 *     --worktree /path/to/worktree
 *
 * Options:
 *   --dir       Required. External sandbox root (no files created inside the repo)
 *   --worktree  Required. Git worktree path (agent's isolated working copy)
 *
 * Environment:
 *   DOGFOOD_BOOTSTRAP_TEST=1  Skip git worktree, deploy, migrate, and portal commands (full CI test mode)
 *   DOGFOOD_BOOTSTRAP_SKIP_PORTAL=1  Skip portal registration only (allows testing worktree creation in CI)
 *   TEST_GIT_REPO=<path>      Git repo root for test mode (default: cwd)
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), ".."));
const DOGFOOD_CONFIG_TEMPLATE = Deno.env.get("OVERRIDE_CONFIG_PATH") || join(REPO_ROOT, "configs/dogfood.toml");
const EXACTL_CMD = ["deno", "run", "-A", join(REPO_ROOT, "apps/exactl/main.ts")];
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

async function run(
  cmd: string[],
  description: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<boolean> {
  console.log(`  ${description}...`);
  const status = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "inherit",
    stderr: "inherit",
    cwd: options.cwd,
    env: options.env,
  }).spawn().status;
  if (!status.success) {
    console.error(`  ❌ ${description} failed`);
    return false;
  }
  return true;
}

async function runCommand(
  cmd: string[],
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
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
  const isTestMode = Deno.env.get("DOGFOOD_BOOTSTRAP_TEST") === "1";
  const skipPortal = Deno.env.get("DOGFOOD_BOOTSTRAP_SKIP_PORTAL") === "1";
  const testGitRepo = Deno.env.get("TEST_GIT_REPO");
  // When SKIP_PORTAL is set with a test git repo, skip deploy/migrate
  // (they need full repo structure) but still create the worktree.
  const testModeForDeploy = isTestMode || (skipPortal && !!testGitRepo);
  const args = Deno.args;

  // Parse --dir and --worktree
  let sandboxRoot: string | undefined;
  let worktreePath: string | undefined;
  let i = 0;
  while (i < args.length) {
    if (args[i] === "--dir" && i + 1 < args.length) {
      sandboxRoot = resolve(args[i + 1]);
      i += 2;
    } else if (args[i] === "--worktree" && i + 1 < args.length) {
      worktreePath = resolve(args[i + 1]);
      i += 2;
    } else {
      i++;
    }
  }

  if (!sandboxRoot || !worktreePath) {
    console.error("Usage: dogfood_bootstrap.ts --dir <sandbox-root> --worktree <worktree-path>");
    Deno.exit(1);
  }

  const gitRepoRoot = testGitRepo ? resolve(testGitRepo) : REPO_ROOT;
  const workspaceDir = join(sandboxRoot, "workspace");
  const configPath = join(workspaceDir, "exa.config.toml");
  const runtimeDir = join(sandboxRoot, ".exa");

  // 1. Validate inputs (always runs, even in test mode — safety checks)
  try {
    await Deno.stat(sandboxRoot);
    console.error(`Error: Sandbox root already exists: ${sandboxRoot}`);
    Deno.exit(1);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      console.error(`Error checking sandbox root: ${e}`);
      Deno.exit(1);
    }
  }
  try {
    await Deno.stat(worktreePath);
    console.error(`Error: Worktree path already exists: ${worktreePath}`);
    Deno.exit(1);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      console.error(`Error checking worktree path: ${e}`);
      Deno.exit(1);
    }
  }

  const gitDir = join(gitRepoRoot, ".git");
  try {
    const st = await Deno.stat(gitDir);
    if (!st.isDirectory && !st.isFile) {
      console.error("Error: Not a git repository (no .git directory found)");
      Deno.exit(1);
    }
  } catch {
    console.error("Error: Not a git repository (no .git directory found)");
    Deno.exit(1);
  }

  console.log(`\nBootstrapping dogfood sandbox at: ${sandboxRoot}`);
  console.log(`  Worktree: ${worktreePath}`);
  console.log(`  Git repo: ${gitRepoRoot}\n`);

  // 2. Create sandbox directory structure
  await Deno.mkdir(sandboxRoot, { recursive: true });

  if (!testModeForDeploy) {
    // 3. Deploy workspace (reuses existing deploy_workspace.ts)
    if (
      !await run(
        ["deno", "run", "-A", join(REPO_ROOT, "scripts/deploy_workspace.ts"), workspaceDir],
        "Deploying workspace",
      )
    ) {
      Deno.exit(1);
    }
  } else {
    // Test mode: create workspace dirs directly (no deploy_workspace.ts needed)
    await Deno.mkdir(workspaceDir, { recursive: true });
    await Deno.mkdir(join(workspaceDir, "Workspace", "Requests"), { recursive: true });
    await Deno.mkdir(join(workspaceDir, "Workspace", "Plans"), { recursive: true });
  }

  // 4. Write dogfood config into workspace (replace sentinels)
  const templateContent = Deno.readTextFileSync(DOGFOOD_CONFIG_TEMPLATE);
  let configContent = templateContent.replaceAll("__DOGFOOD_ROOT__", sandboxRoot);
  configContent = configContent.replaceAll("__WORKTREE_PATH__", worktreePath);
  Deno.writeTextFileSync(configPath, configContent);
  console.log(`  ✅ Dogfood config written to ${configPath}`);

  // 5. Initialize database
  if (!testModeForDeploy) {
    if (
      !await run(
        ["deno", "run", "-A", join(REPO_ROOT, "scripts/migrate_db.ts"), "up"],
        "Initializing database",
        { env: { EXA_CONFIG_PATH: configPath } },
      )
    ) {
      Deno.exit(1);
    }
  }

  // 6. Create git worktree (skip only in full test mode)
  if (!isTestMode) {
    if (
      !await run(
        ["git", "worktree", "add", "--force", worktreePath, "HEAD"],
        "Creating git worktree",
        { cwd: gitRepoRoot },
      )
    ) {
      console.error("Failed to create worktree. See output above.");
      Deno.exit(1);
    }
  }

  // 7. Register portal and wait for knowledge (skip when SKIP_PORTAL is set or in full test mode)
  if (!isTestMode && !skipPortal) {
    const portalResult = await runCommand(
      [...EXACTL_CMD, "portal", "add", worktreePath, "exaix-self"],
    );
    if (portalResult.code !== 0) {
      console.error(`Failed to register portal: ${portalResult.stderr.trim()}`);
      Deno.exit(1);
    }
    console.log("  ✅ Portal exaix-self registered");

    // 8. Wait for portal knowledge
    console.log("  Waiting for portal knowledge...");
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let knowledgeReady = false;
    while (Date.now() < deadline) {
      const knResult = await runCommand(
        [...EXACTL_CMD, "portal", "knowledge", "exaix-self", "--json"],
      );
      if (knResult.code === 0 && knResult.stdout.trim().length > 0 && knResult.stdout.trim() !== "{}") {
        knowledgeReady = true;
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (knowledgeReady) {
      console.log("  ✅ Portal knowledge ready");
    } else {
      console.error("  ⚠️  Portal knowledge not generated within timeout (you can run: exactl portal analyze exaix-self)");
    }
  }

  console.log(`\n✅ Bootstrap complete!`);
  console.log(`  Sandbox: ${sandboxRoot}`);
  console.log(`  Worktree: ${worktreePath}`);
  console.log(`  Config: ${configPath}`);
  console.log(`\nStart the daemon with:`);
  console.log(`  EXA_CONFIG_PATH=${configPath} deno task dogfood`);
  console.log(`\nOr set up aliases:`);
  console.log(`  export DOGFOOD_SANDBOX=${sandboxRoot}`);
  console.log(`  export EXA_CONFIG_PATH=${configPath}`);
  console.log(`  deno task dogfood`);
}

if (import.meta.main) {
  main();
}
