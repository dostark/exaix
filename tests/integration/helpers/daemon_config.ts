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

import { dirname, join } from "@std/path";

/** Repo root, from `tests/integration/helpers/` — the source of `migrations/` and `deno.json`. */
const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..");

/** Migrates a workspace's `.exa/journal.db` via `scripts/setup_db.ts` before daemon boot — unmigrated, a Team daemon dies at startup with `no such table: model_benchmark`. Idempotent. */
export async function migrateDaemonWorkspace(root: string): Promise<void> {
  const result = await new Deno.Command("deno", {
    args: ["run", "-A", "--config", join(REPO_ROOT, "deno.json"), join(REPO_ROOT, "scripts", "setup_db.ts")],
    cwd: root,
    env: { EXA_MIGRATIONS_DIR: join(REPO_ROOT, "migrations") },
  }).output();
  // Fatal, not a warning: a daemon booting on an unmigrated database fails later on whichever
  // table it happens to touch first, which reads as an unrelated defect. Fail here instead.
  if (!result.success) {
    throw new Error(
      `setup_db.ts exited ${result.code} for workspace ${root}; the daemon database would be unmigrated.\n` +
        new TextDecoder().decode(result.stderr),
    );
  }
}

export function writeDaemonConfig(
  configPath: string,
  root: string,
  allowNetLine = "allow_net = []",
): void {
  const cfg = daemonConfigSections(root, allowNetLine).join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

/** Portal dir must be separate from the daemon root, or the git audit flags the daemon's own runtime writes (.exa/*.db, logs/, ...) as unauthorized changes. */
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

/** Bootstrap TOML config with a mock (non-networked) AI provider, for daemon-boot tests that don't need real network calls. */
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

/** Reads a daemon.pid and asserts it's a live PID — used by leak-guard tests to capture the PID before a deliberate failure, to later confirm teardown killed it. */
export async function readDaemonPid(pidPath: string): Promise<number> {
  const pid = parseInt((await Deno.readTextFile(pidPath)).trim(), 10);
  if (Number.isNaN(pid)) {
    throw new Error(`daemon.pid at ${pidPath} did not contain a numeric PID`);
  }
  return pid;
}

/** Asserts a previously-captured PID is dead. `Deno.kill(pid, "SIGCONT")` is a harmless liveness probe — throws `NotFound` if dead, succeeds silently if alive. */
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

/** Boots the real daemon, settles, then SIGTERM's it; migrates the workspace first (see {@link migrateDaemonWorkspace}). `midFlight`, if given, runs after settle to inject an external Config DB override the daemon must pick up. */
export async function bootRealDaemon(
  configPath: string,
  settleMs: number,
  options: {
    extraEnv?: Record<string, string>;
    midFlight?: () => void;
    afterInjectMs?: number;
  } = {},
): Promise<void> {
  await migrateDaemonWorkspace(dirname(configPath));
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
