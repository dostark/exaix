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

export function writeDaemonConfig(
  configPath: string,
  root: string,
  allowNetLine = "allow_net = []",
): void {
  const cfg = daemonConfigSections(root, allowNetLine).join("\n");
  Deno.writeTextFileSync(configPath, cfg);
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
