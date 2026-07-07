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
