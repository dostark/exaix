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
import { ensureDir, exists } from "@std/fs";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { copy, type CopyOptions } from "@std/fs/copy";

// Source directories a **Solo** deploy copies into a standalone workspace. `exaix-team/`
// is deliberately EXCLUDED: it is BSL-licensed Team code that must not ship in a Solo
// deployment. Safe because app entry points load `@exaix-team/*` only when editionType !== "solo".
/** Minimal shape of a deno.json config the deploy rewrites (`workspace`, `lint.plugins`, and `tasks`). */
export interface IDenoConfigShape {
  workspace?: string[];
  lint?: { plugins?: string[] };
  tasks?: Record<string, string>;
}

export const WORKSPACE_COPY_DIRS: readonly string[] = [
  "packages",
  "apps",
  "migrations",
];

/** The scripts a deploy copies into `scripts/`. */
export const DEPLOYED_SCRIPT_FILES: readonly string[] = [
  "setup_db.ts",
  "migrate_db.ts",
  "scaffold.ts",
  "deploy_workspace.ts",
  "activity_cache_schema.ts",
  "journal_integrity_schema.ts",
  "provider_costs_schema.ts",
  "skill_journal_schema.ts",
];

const DEV_ONLY_MEMBERS: readonly string[] = ["exaix-team/", "./unslop-ts"];
const UNDEPLOYED_DIR_REFERENCES: readonly string[] = ["unslop-ts/", "packages/lint-policy/"];
const SCRIPT_REFERENCE = /(?:^|[\s'"=])(?:\.\/)?scripts\/([^\s'"/]+\.ts)/g;

/** True when a task command runs a script the deploy omits, the engine submodule, or the lint policy package. */
function runsUndeployedFile(command: string): boolean {
  if (UNDEPLOYED_DIR_REFERENCES.some((dir) => command.includes(dir))) return true;
  return [...command.matchAll(SCRIPT_REFERENCE)].some((match) => !DEPLOYED_SCRIPT_FILES.includes(match[1]));
}

// Drop workspace members, lint plugins, and tasks that point at paths the deploy does not copy.
// Other config fields stay unchanged.
export function stripDevOnlyConfig<T extends IDenoConfigShape>(denoConfig: T): T {
  const stripped: T = { ...denoConfig };
  if (Array.isArray(denoConfig.workspace)) {
    stripped.workspace = denoConfig.workspace.filter(
      (member) => !DEV_ONLY_MEMBERS.some((devOnly) => member.includes(devOnly)),
    );
  }
  if (denoConfig.lint?.plugins !== undefined) {
    const { plugins: _plugins, ...otherLint } = denoConfig.lint;
    stripped.lint = otherLint;
  }
  if (denoConfig.tasks !== undefined) {
    stripped.tasks = Object.fromEntries(
      Object.entries(denoConfig.tasks).filter(([, command]) => !runsUndeployedFile(command)),
    );
  }
  return stripped;
}

/** The trusted portal lint policy root a deploy installs. */
export const LINT_POLICY_DIR = "lint";

/** The root task that builds a policy directory from the portal configuration. */
const LINT_POLICY_TASK = "unslop-ts:policy";
const POLICY_MANIFEST = "manifest.json";
const POLICY_CONFIG = "deno.json";

/** Verifies one installed policy directory, returning its manifest-declared file names. */
export async function verifyLintPolicyDir(dir: string): Promise<readonly string[]> {
  const manifestPath = join(dir, POLICY_MANIFEST);
  if (!(await exists(manifestPath))) throw new Error(`lint policy manifest missing: ${manifestPath}`);
  const manifestMode = await Deno.lstat(manifestPath);
  if (!manifestMode.isFile || manifestMode.isSymlink) throw new Error("lint policy manifest must be a regular file");
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath)) as {
    format_version?: number;
    files?: Record<string, { sha256?: string; bytes?: number }>;
  };
  if (manifest.format_version !== 1 || manifest.files === undefined) {
    throw new Error(`lint policy manifest is invalid: ${manifestPath}`);
  }
  const names = Object.keys(manifest.files).sort();
  if (!names.includes(POLICY_CONFIG)) throw new Error(`lint policy manifest omits ${POLICY_CONFIG}`);
  for (const name of names) {
    const entry = manifest.files[name];
    if (entry?.sha256 === undefined || entry.bytes === undefined) {
      throw new Error(`lint policy manifest omits the hash of ${name}`);
    }
    const path = join(dir, name);
    const mode = await Deno.lstat(path).catch(() => null);
    if (mode === null || !mode.isFile || mode.isSymlink) {
      throw new Error(`lint policy file must be a regular file: ${name}`);
    }
    const bytes = await Deno.readFile(path).catch(() => null);
    if (bytes === null) throw new Error(`lint policy file missing: ${name}`);
    if (bytes.byteLength !== entry.bytes) throw new Error(`lint policy size mismatch: ${name}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== entry.sha256) throw new Error(`lint policy checksum mismatch: ${name}`);
  }
  return names;
}

/** Installs one verified policy directory, replacing the destination only after staging validates. */
export async function installLintPolicyDir(sourceDir: string, destDir: string): Promise<void> {
  const names = await verifyLintPolicyDir(sourceDir);
  const staging = `${destDir}.staging-${crypto.randomUUID()}`;
  await ensureDir(staging);
  try {
    for (const name of [...names, POLICY_MANIFEST]) {
      await copy(join(sourceDir, name), join(staging, name), { overwrite: true });
    }
    await verifyLintPolicyDir(staging);
    const backup = `${destDir}.previous-${crypto.randomUUID()}`;
    const hadDestination = await exists(destDir);
    if (hadDestination) await Deno.rename(destDir, backup);
    try {
      await Deno.rename(staging, destDir);
    } catch (error) {
      if (hadDestination) await Deno.rename(backup, destDir).catch(() => {});
      throw error;
    }
    if (hadDestination) await Deno.remove(backup, { recursive: true }).catch(() => {});
  } finally {
    await Deno.remove(staging, { recursive: true }).catch(() => {});
  }
}

/** Names the verified policy directories under one policy root. */
async function listLintPolicies(root: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(root)) {
      if (!entry.isDirectory || entry.name.startsWith(".")) continue;
      if (await exists(join(root, entry.name, POLICY_MANIFEST))) names.push(entry.name);
    }
  } catch {
    return [];
  }
  return names.sort();
}

/** Installs every verified policy directory from one root into the destination. */
async function installLintPoliciesFrom(sourceRoot: string, dest: string): Promise<void> {
  const names = await listLintPolicies(sourceRoot);
  if (names.length === 0) throw new Error(`no lint policy directory in ${sourceRoot}`);
  for (const name of names) {
    await installLintPolicyDir(join(sourceRoot, name), join(dest, LINT_POLICY_DIR, name));
  }
}

/** Builds policies in a source checkout, or copies existing verified directories in a deployed workspace. */
export async function deployLintPolicies(repoRoot: string, dest: string): Promise<void> {
  await assertDistinctDeploymentRoots(repoRoot, dest);
  const engineSource = join(repoRoot, "unslop-ts", "scripts", "bundle.ts");
  if (await exists(engineSource)) {
    await buildAndInstallLintPolicies(repoRoot, dest);
    return;
  }
  const sourceRoot = join(repoRoot, LINT_POLICY_DIR);
  if ((await listLintPolicies(sourceRoot)).length === 0) {
    throw new Error(
      "lint policy unavailable: initialize the engine source with `deno task unslop-ts:deploy --init` in a source checkout, or redeploy from a workspace that already carries lint/<policy>/ directories",
    );
  }
  await installLintPoliciesFrom(sourceRoot, dest);
}

/** Rejects physical aliases of the source before any deployment side effect. */
async function assertDistinctDeploymentRoots(repoRoot: string, dest: string): Promise<void> {
  let physicalDest: string;
  try {
    physicalDest = await Deno.realPath(dest);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    physicalDest = resolve(dest);
  }
  if (await Deno.realPath(repoRoot) === physicalDest) {
    throw new Error("lint policy deploy refused: source and destination are identical");
  }
}

/** Runs the installer task in a child and installs only its verified staged directories. */
async function buildAndInstallLintPolicies(repoRoot: string, dest: string): Promise<void> {
  await ensureDir(dest);
  const staging = await Deno.makeTempDir({ dir: dest, prefix: "lint-build-" });
  try {
    const built = await run([Deno.execPath(), "task", LINT_POLICY_TASK, "--out", staging], { cwd: repoRoot });
    if (!built) throw new Error("lint policy source packaging failed");
    await installLintPoliciesFrom(staging, dest);
  } finally {
    await Deno.remove(staging, { recursive: true });
  }
}

/** Copy each existing WORKSPACE_COPY_DIRS entry from repoRoot into dest. */
async function copyWorkspaceDirs(
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
  await assertDistinctDeploymentRoots(repoRoot, dest);

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

  // Copy deno.json without the dev-only members, lint plugins, and tasks that a Solo deploy omits.
  // The @exaix-team/* import-map entries stay, so a Team run can resolve Team modules when exaix-team/ is present.
  // A Solo run never loads them.
  const denoConfig = JSON.parse(await Deno.readTextFile(join(repoRoot, "deno.json")));
  await Deno.writeTextFile(
    join(dest, "deno.json"),
    JSON.stringify(stripDevOnlyConfig(denoConfig), null, 2) + "\n",
  );

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

  // Copy workspace members (packages, apps) + migrations. exaix-team/ is EXCLUDED —
  // it is BSL Team code that must not ship in a Solo deploy; the apps load @exaix-team/*
  // dynamically only in the Team branch, so a Solo run never needs it on disk.
  await copyWorkspaceDirs(repoRoot, dest, copyOpts);

  // Copy runtime scripts
  const scriptFiles = DEPLOYED_SCRIPT_FILES;
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
    console.log(`Caching Solo runtime entries and running setup in ${dest}...`);
    // Cache only the Solo runtime entries. exaix-team/apps/mcp-server/main.ts (which statically
    // imports @exaix-team/mcp-server) is not copied into a Solo deploy at all; `exactl mcp`
    // spawns it as a subprocess only under Team.
    await run([
      "deno",
      "cache",
      "--config",
      join(dest, "deno.json"),
      join(dest, "apps/daemon/main.ts"),
      join(dest, "apps/exactl/main.ts"),
      join(dest, "apps/tui/main.ts"),
    ], { cwd: dest });
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

  console.log("Installing portal lint policy...");
  await deployLintPolicies(repoRoot, dest);

  console.log(`\nDeployment complete. User workspace at: ${dest}`);
  console.log("\nNext steps:");
  console.log(`  cd ${dest}`);
  console.log("  cp exa.config.sample.toml exa.config.toml");
  console.log("  exactl daemon start");
}

if (import.meta.main) {
  await main();
}
