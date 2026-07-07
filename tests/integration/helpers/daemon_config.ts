/**
 * @module DaemonConfigHelper
 * @path tests/integration/helpers/daemon_config.ts
 * @description Shared daemon TOML config builder for integration tests.
 *   Extracted to eliminate duplication across daemon_* and dogfood_* tests.
 *
 * Note: Phase 137 moves most settings to Config DB via configurable().
 * Only system.root is strictly required here. The additional sections
 * exist for backward compatibility; new tests should use the adapter.
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
    // Note: remaining sections are legacy — all settings are overridable
    // via `exactl config set` and persisted in .exa/config.db.
    "",
    "[paths]",
    'workspace = "./Workspace"',
    'blueprints = "./Blueprints"',
    'runtime = "./.exa"',
    'memory = "./Memory"',
    'portals = "./Portals"',
    'active = "Active"',
    'plans = "Plans"',
    'requests = "Requests"',
    "",
    "[watcher]",
    "debounce_ms = 100",
    "stability_check = false",
    "",
    "[database]",
    "batch_flush_ms = 50",
    "batch_max_size = 100",
    "",
    "[database.sqlite]",
    'journal_mode = "WAL"',
    "foreign_keys = true",
    "busy_timeout_ms = 5000",
    "",
    "[quality_gate]",
    "enabled = false",
    "",
    "[mcp]",
    "enabled = false",
    'transport = "stdio"',
    'server_name = "exaix"',
    'version = "1.0.0"',
    "[agents]",
    'default_model = "default"',
    "",
    "[models.default]",
    'provider = "mock"',
    'model = "gpt-5.2-pro"',
    "timeout_ms = 30000",
    "",
    "[models.fast]",
    'provider = "mock"',
    'model = "gpt-5.2-pro-mini"',
    "timeout_ms = 15000",
    "",
  ];
}
