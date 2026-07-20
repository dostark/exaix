/**
 * @module DaemonConfigHelper
 * @path tests/integration/helpers/daemon_config.ts
 * @description Shared daemon TOML config builder for integration tests.
 *
 * Phase 137: TOML is bootstrap-only — only system.root is strictly needed.
 * Additional sections below preserve backward compatibility for tests that
 * read paths/configs from the parsed TOML. New tests should use the
 * adapter pattern (DirectConfigAdapter.set()) instead.
 */

import { join } from "@std/path";

export function writeDaemonConfig(
  configPath: string,
  root: string,
  allowNetLine = "allow_net = []",
): void {
  const cfg = daemonConfigSections(root, allowNetLine).join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

/**
 * `workspace` portal's target_path must be a directory SEPARATE from the daemon's
 * own root — the git audit runs `git status` at the portal path, and if it aliases
 * the daemon root, the daemon's own runtime writes (.exa/*.db, logs/, Memory/Skills/
 * index.json, ...) all show up as "changed" and are flagged as unauthorized, since
 * they are never in the plan step's files_changed. `ensureRepository()` git-inits
 * the portal directory itself, so it only needs to exist on disk first.
 */
export function writePortalDir(root: string): string {
  const portalDir = join(root, "portal-repo");
  Deno.mkdirSync(portalDir, { recursive: true });
  return portalDir;
}

export function daemonConfigSections(root: string, allowNetLine = "allow_net = []"): string[] {
  return [
    "[system]",
    `root = "${root}"`,
    allowNetLine,
    "",
    "[paths]",
    'workspace = "./Workspace"',
    'blueprints = "./Blueprints"',
    'runtime = "./.exa"',
    'memory = "./Memory"',
    'portals = "./Portals"',
  ];
}

/**
 * Write a bootstrap TOML config with a mock AI provider, used by daemon-boot
 * integration tests that spawn `apps/daemon/main.ts` and only need a valid
 * bootstrap plus a non-networked provider.
 */
export function writeDaemonConfigWithMockAi(configPath: string, root: string): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[ai.mock]",
    "timeout_ms = 30000",
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

/**
 * Read a daemon.pid file and assert it holds a live, numeric PID. Used by
 * leak-guard regression tests that must capture the PID before deliberately
 * triggering a failure, so they can later confirm teardown actually killed it.
 */
export async function readDaemonPid(pidPath: string): Promise<number> {
  const pid = parseInt((await Deno.readTextFile(pidPath)).trim(), 10);
  if (Number.isNaN(pid)) {
    throw new Error(`daemon.pid at ${pidPath} did not contain a numeric PID`);
  }
  return pid;
}

/**
 * Assert that a previously-captured daemon PID is no longer alive. `Deno.kill`
 * with SIGCONT is a liveness probe (delivering a harmless signal): it throws
 * `NotFound` for a dead PID and succeeds silently for a live one.
 */
export function assertDaemonPidIsDead(pid: number): void {
  let stillAlive = true;
  try {
    Deno.kill(pid, "SIGCONT");
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      stillAlive = false;
    } else {
      throw e;
    }
  }
  if (stillAlive) {
    throw new Error(`daemon PID ${pid} must not survive a failed assertion mid-lifecycle`);
  }
}

/**
 * Boot the real daemon (`apps/daemon/main.ts`) as a subprocess, let it settle for
 * `settleMs`, then SIGTERM it. `extraEnv` merges over the base test env. If provided,
 * `midFlight` runs after the daemon has settled and before the post-inject wait — used
 * to write an external Config DB override the running daemon must pick up.
 */
export async function bootRealDaemon(
  configPath: string,
  settleMs: number,
  options: {
    extraEnv?: Record<string, string>;
    midFlight?: () => void;
    afterInjectMs?: number;
  } = {},
): Promise<void> {
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", "apps/daemon/main.ts"],
    stdin: "null",
    stdout: "null",
    stderr: "null",
    env: { EXA_CONFIG_PATH: configPath, EXA_TEST_MODE: "1", ...options.extraEnv },
  }).spawn();
  try {
    await new Promise((r) => setTimeout(r, settleMs));
    if (options.midFlight) {
      options.midFlight();
      await new Promise((r) => setTimeout(r, options.afterInjectMs ?? 0));
    }
  } finally {
    try {
      Deno.kill(proc.pid, "SIGTERM");
    } catch { /* already dead */ }
    try {
      await proc.status;
    } catch { /* already finished */ }
  }
}
