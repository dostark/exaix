/**
 * @module ConfigTestHelpers
 * @path tests/helpers/config.ts
 * @description Provides common utilities for mocking system configuration,
 * ensuring stable behavior across AI, database, and infrastructure tests.
 */

import { type Config, ConfigSchema } from "@exaix/schemas/config.ts";
import { ConfigService } from "@exaix/core/config/service.ts";
import { join } from "@std/path";
import { getDefaultPaths } from "@exaix/core/config/paths.ts";
import { SqliteJournalMode } from "@exaix/core";
import { ExaPathDefaults } from "@exaix/core";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";

/**
 * Creates a mock configuration for testing.
 * @param root The root directory for the mock system.
 * @param overrides Optional overrides for specific config sections.
 */
export function createMockConfig(root: string, overrides: Partial<Config> = {}): Config {
  const defaultModels = {
    default: { provider: "mock", model: "gpt-5.2-pro", timeout_ms: 30000 },
    fast: { provider: "mock", model: "gpt-5.2-pro-mini", timeout_ms: 30000 },
    local: { provider: "ollama", model: "llama3.2", timeout_ms: 30000 },
  };

  // Use getDefaultPaths for consistent path defaults
  const pathDefaults = getDefaultPaths(root);

  // Create default workspace portal for tests that need it
  const defaultPortals = overrides.portals ?? [{
    alias: "workspace",
    target_path: root,
    default_branch: TEST_DEFAULT_BRANCH,
    identities_allowed: ["*"],
    operations: [],
  }];

  return ConfigSchema.parse({
    ...overrides,
    system: {
      ...(overrides.system ?? {}),
      root,
      version: overrides.system?.version ?? "1.0.0",
    },
    // Provide explicit path defaults - schema defaults may not apply correctly with empty object
    paths: {
      workspace: pathDefaults.workspace,
      runtime: pathDefaults.runtime,
      memory: pathDefaults.memory,
      portals: pathDefaults.portals,
      blueprints: pathDefaults.blueprints,
      active: pathDefaults.active,
      archive: pathDefaults.archive,
      plans: pathDefaults.plans,
      requests: pathDefaults.requests,
      rejected: pathDefaults.rejected,
      identities: pathDefaults.identities,
      flows: pathDefaults.flows,
      memoryProjects: pathDefaults.memoryProjects,
      memoryExecution: pathDefaults.memoryExecution,
      memoryIndex: pathDefaults.memoryIndex,
      memorySkills: pathDefaults.memorySkills,
      memoryPending: pathDefaults.memoryPending,
      memoryTasks: pathDefaults.memoryTasks,
      memoryGlobal: pathDefaults.memoryGlobal,
      ...(overrides.paths ?? {}),
    },
    // Provide stable defaults used by many tests, while still allowing overrides.
    database: overrides.database ?? {
      batch_flush_ms: 100,
      batch_max_size: 100,
      sqlite: {
        journal_mode: SqliteJournalMode.WAL,
        foreign_keys: true,
        busy_timeout_ms: 5000,
      },
      failure_threshold: 5,
      reset_timeout_ms: 60000,
      half_open_success_threshold: 2,
    },
    models: overrides.models ?? defaultModels,
    provider_strategy: {
      ...(overrides.provider_strategy ?? {}),
      fallback_chains: overrides.provider_strategy?.fallback_chains ?? {},
    },
    // Disable quality gate by default in tests so processor tests are not
    // interrupted by heuristic scores on short test bodies. Tests that
    // specifically exercise the quality gate pass an explicit testQualityGate
    // stub or patch this field in their own config.
    quality_gate: overrides.quality_gate ?? { enabled: false },
    // Provide default workspace portal for tests
    portals: defaultPortals,
  });
}

/**
 * Creates a test config file and ConfigService for testing
 */
export async function createTestConfigService(root: string): Promise<ConfigService> {
  const configPath = join(root, "exa.config.toml");

  const configContent = `[system]
version = "1.0.0"
log_level = "info"
root = "${root}"

[paths]
memory = "${ExaPathDefaults.memory}"
blueprints = "${ExaPathDefaults.blueprints}"
runtime = "${ExaPathDefaults.runtime}"
portals = "${ExaPathDefaults.portals}"
workspace = "${ExaPathDefaults.workspace}"
active = "${ExaPathDefaults.active}"
archive = "${ExaPathDefaults.archive}"
plans = "${ExaPathDefaults.plans}"
requests = "${ExaPathDefaults.requests}"
rejected = "${ExaPathDefaults.rejected}"
agents = "${ExaPathDefaults.identities}"
flows = "${ExaPathDefaults.flows}"
memoryProjects = "${ExaPathDefaults.memoryProjects}"
memoryExecution = "${ExaPathDefaults.memoryExecution}"
memoryIndex = "${ExaPathDefaults.memoryIndex}"
memorySkills = "${ExaPathDefaults.memorySkills}"
memoryPending = "${ExaPathDefaults.memoryPending}"
memoryTasks = "${ExaPathDefaults.memoryTasks}"
memoryGlobal = "${ExaPathDefaults.memoryGlobal}"

[database]
batch_flush_ms = 100
batch_max_size = 100

[database.sqlite]
journal_mode = "WAL"
foreign_keys = true
busy_timeout_ms = 5000

[watcher]
debounce_ms = 200
stability_check = true

[agents]
default_model = "default"
timeout_sec = 60
  max_iterations = 10

[models.default]
provider = "mock"
model = "gpt-5.2-pro"

[models.fast]
provider = "mock"
model = "gpt-5.2-pro-mini"

[models.local]
provider = "ollama"
model = "llama3.2"

[ai_endpoints]
ollama = ""
anthropic = ""
openai = ""
google = ""

[ai_retry]
max_attempts = 3
backoff_base_ms = 1000
timeout_per_request_ms = 30000

[ai_anthropic]
api_version = "2023-06-01"
default_model = "claude-opus-4-6"
max_tokens_default = 4096

[mcp_defaults]
identity_id = "system"

[git]
branch_prefix_pattern = "^(feat|fix|docs|chore|refactor|test)/"
allowed_prefixes = ["feat", "fix", "docs", "chore", "refactor", "test"]

[provider_strategy.fallback_chains]
# Empty to avoid validation errors with default chains referencing non-existent models
`;

  await Deno.writeTextFile(configPath, configContent);

  // Create service with absolute path
  const service = new ConfigService(configPath);

  return service;
}
