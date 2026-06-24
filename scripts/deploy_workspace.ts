#!/usr/bin/env -S deno run -A
/**
 * @module DeployWorkspace
 * @path scripts/deploy_workspace.ts
 * @description Creates a standalone, deployable Exaix workspace including config and migrations.
 *
 * Usage:
 *   deno run -A scripts/deploy_workspace.ts --destination <path> [options]
 *
 * Options:
 *   --destination <path>  Required. The output directory for the deployed workspace.
 *   --no-run              Skip executing the post-deployment setup (migration/scaffold).
 */

import { parse } from "@std/flags";
import { ensureDir } from "@std/fs";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { copy, type CopyOptions } from "@std/fs/copy";

/**
 * Source directories the deploy copies into a standalone workspace. The deployed
 * deno.json's import map points `@exaix-team/*` at `./packages-team/` and its `workspace`
 * array lists packages-team members, and apps/ statically import `@exaix-team/team-composer`
 * (dead-code-eliminated at runtime in Solo, but still resolved at module load) — so
 * `packages-team` MUST be copied or a deployed exactl/daemon fails with
 * `Module not found ".../packages-team/team-composer/mod.ts"`.
 */
export const WORKSPACE_COPY_DIRS: readonly string[] = [
  "packages",
  "packages-team",
  "apps",
  "migrations",
];

/** Copy each existing WORKSPACE_COPY_DIRS entry from repoRoot into dest. */
export async function copyWorkspaceDirs(
  repoRoot: string,
  dest: string,
  copyOpts: CopyOptions,
): Promise<void> {
  for (const dir of WORKSPACE_COPY_DIRS) {
    const source = join(repoRoot, dir);
    if (await Deno.stat(source).then((s) => s.isDirectory).catch(() => false)) {
      console.log(`Copying ${dir}/...`);
      await copy(source, join(dest, dir), copyOpts);
    }
  }
}

async function run(cmd: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: options.cwd,
    env: options.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await command.spawn().status;
  return status.success;
}

async function main() {
  const flags = parse(Deno.args, {
    boolean: ["no-run"],
    alias: { "no-run": "n" },
  });

  const repoRoot = resolve(join(dirname(fromFileUrl(import.meta.url)), ".."));
  const dest = resolve(flags._[0] as string || join(Deno.env.get("HOME") || ".", "Exaix"));

  console.log(`Deploying Exaix workspace to: ${dest}`);

  await ensureDir(dest);

  // 1. Run scaffold
  console.log("Running scaffold to prepare runtime folders and templates...");
  const scaffoldSuccess = await run(["deno", "run", "-A", join(repoRoot, "scripts/scaffold.ts"), dest]);
  if (!scaffoldSuccess) {
    console.warn("Warning: Scaffold failed or partially failed.");
  }

  // 2. Copy artifacts
  const copyOpts: CopyOptions = { overwrite: true };

  // Copy deno.json
  await copy(join(repoRoot, "deno.json"), join(dest, "deno.json"), copyOpts);

  // Copy Memory/ (all content)
  const memorySource = join(repoRoot, "Memory");
  if (await Deno.stat(memorySource).then((s) => s.isDirectory).catch(() => false)) {
    console.log("Copying Memory/...");
    await copy(memorySource, join(dest, "Memory"), copyOpts);
  }

  // Copy Blueprints/
  const blueprintsSource = join(repoRoot, "Blueprints");
  if (await Deno.stat(blueprintsSource).then((s) => s.isDirectory).catch(() => false)) {
    console.log("Copying Blueprints/...");
    await copy(blueprintsSource, join(dest, "Blueprints"), copyOpts);
  }

  // Copy top-level docs
  console.log("Copying docs/...");
  await ensureDir(join(dest, "docs"));
  for await (const entry of Deno.readDir(join(repoRoot, "docs"))) {
    if (entry.isFile) {
      await copy(join(repoRoot, "docs", entry.name), join(dest, "docs", entry.name), copyOpts);
    }
  }

  // Copy workspace members (packages, packages-team, apps) + migrations. packages-team
  // MUST be included so the deployed deno.json's @exaix-team/* import map + workspace
  // members resolve (apps/exactl + apps/daemon statically import @exaix-team/team-composer).
  await copyWorkspaceDirs(repoRoot, dest, copyOpts);

  // Copy runtime scripts
  const scriptFiles = ["setup_db.ts", "migrate_db.ts", "scaffold.ts", "deploy_workspace.ts"];
  await ensureDir(join(dest, "scripts"));
  for (const f of scriptFiles) {
    try {
      await copy(join(repoRoot, "scripts", f), join(dest, "scripts", f), copyOpts);
    } catch {
      // Ignore if missing
    }
  }

  // 3. Post-deploy tasks
  if (!flags["no-run"]) {
    console.log(`Running deno task cache and setup in ${dest}...`);
    await run(["deno", "task", "cache"], { cwd: dest });
    await run(["deno", "task", "setup"], { cwd: dest });

    // Install exactl shim
    const binPath = Deno.env.get("EXA_BIN_PATH");
    if (binPath) {
      const exactlBin = join(binPath, "exactl");
      console.log(`Writing exactl shim to ${exactlBin}...`);
      await ensureDir(binPath);
      const shim =
        `#!/bin/sh\nexport EXA_CONFIG_PATH="\${EXA_CONFIG_PATH:-${dest}/exa.config.toml}"\nexec deno run --allow-all --config "${dest}/deno.json" "${dest}/apps/exactl/main.ts" "$@"\n`;
      await Deno.writeTextFile(exactlBin, shim);
      await Deno.chmod(exactlBin, 0o755);
    } else {
      console.log("Installing exactl CLI globally...");
      await run([
        "deno",
        "install",
        "--global",
        "--allow-all",
        "--force",
        "--config",
        "deno.json",
        "-n",
        "exactl",
        "apps/exactl/main.ts",
      ], { cwd: dest });
    }
  }

  console.log(`\nDeployment complete. User workspace at: ${dest}`);
  console.log("\nNext steps:");
  console.log(`  cd ${dest}`);
  console.log("  cp exa.config.sample.toml exa.config.toml");
  console.log("  exactl daemon start");
}

if (import.meta.main) {
  await main();
}
