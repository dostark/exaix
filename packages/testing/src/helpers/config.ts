/**
 * @module ConfigTestHelpers
 * @path packages/testing/src/helpers/config.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Provides common utilities for mocking system configuration,
 * ensuring stable behavior across AI, database, and infrastructure tests.
 */

import { Database } from "@db/sqlite";
import { type Config, ConfigSchema } from "@exaix/schemas/config.ts";
import { join } from "@std/path";
import { createConfigAdapter, ensureConfigDb, migrateConfigDb, seedConfigDb } from "@exaix/core/config";
import type { IConfigAdapter } from "@exaix/core/config";
import { DEFAULT_TIMEOUT_MS, SqliteJournalMode } from "@exaix/core";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { TEST_PORTAL_ALIAS } from "./constants.ts";

export function createMockConfig(root: string, overrides: Partial<Config> = {}): Config {
  const defaultModels = {
    default: { provider: "mock", model: "gpt-5.2-pro", timeout_ms: DEFAULT_TIMEOUT_MS },
    fast: { provider: "mock", model: "gpt-5.2-pro-mini", timeout_ms: DEFAULT_TIMEOUT_MS },
    local: { provider: "ollama", model: "llama3.2", timeout_ms: DEFAULT_TIMEOUT_MS },
  };

  // Create default workspace portal for tests that need it
  const defaultPortals = overrides.portals ?? [{
    alias: TEST_PORTAL_ALIAS,
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
    // ConfigSchema.paths defaults every field when omitted; only pass overrides through.
    paths: overrides.paths,
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
    // Off by default so heuristic scores on short test bodies don't interrupt tests.
    quality_gate: overrides.quality_gate ?? { enabled: false },
    // Provide default workspace portal for tests
    portals: defaultPortals,
  });
}

/** Writes only the bootstrap TOML sections; most settings live in .exa/config.db —
 *  use DirectConfigAdapter.set() or seedConfigDb() for other overrides. */
export async function writeTestConfigFile(root: string): Promise<string> {
  const configPath = join(root, "exa.config.toml");

  const configContent = `[system]
root = "${root}"
`;

  await Deno.writeTextFile(configPath, configContent);
  return configPath;
}

export function createTestConfigDb(root: string): string {
  const dbPath = ensureConfigDb(root);
  const db = new Database(dbPath);
  migrateConfigDb(db);
  seedConfigDb(db);
  db.close();
  return dbPath;
}

export function createTestAdapter(root: string): IConfigAdapter {
  const dbPath = createTestConfigDb(root);
  return createConfigAdapter(dbPath);
}

export function simulateDaemonBoot(tempDir: string): IConfigAdapter {
  const configPath = join(tempDir, "exa.config.toml");
  Deno.writeTextFileSync(
    configPath,
    `[system]\nroot = "${tempDir}"\nschema_version = "1.0.0"\n`,
  );
  return createTestAdapter(tempDir);
}
