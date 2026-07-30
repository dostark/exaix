/**
 * @module DatabaseTestHelper
 * @path packages/testing/src/helpers/init_db.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Test helper utilities for database setup and testing.
 */

import { Database } from "@db/sqlite";
import { DatabaseService } from "@exaix/storage-sqlite";
import { createMockConfig } from "./config.ts";
import { existsSync } from "@std/fs";
import { join } from "@std/path";
import { REVIEW_STATUS_VALUES } from "@exaix/core/status";
import type { Config } from "@exaix/schemas/config.ts";

/**
 * SQL statement to create the activity table with all indexes.
 * Centralized here to avoid duplication across tests.
 */
export const ACTIVITY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    actor_type TEXT,
    identity_id TEXT,
    agent_kind TEXT,
    action_type TEXT NOT NULL,
    target TEXT,
    payload TEXT NOT NULL,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0.0,
    timestamp DATETIME DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_activity_trace ON activity(trace_id);
  CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity(identity_id);
  CREATE INDEX IF NOT EXISTS idx_activity_identity ON activity(identity_id);
  CREATE INDEX IF NOT EXISTS idx_activity_actor_type ON activity(actor_type);
  CREATE INDEX IF NOT EXISTS idx_activity_agent_kind ON activity(agent_kind);
`;

/**
 * Initialize an in‑memory SQLite database with the `activity` table.
 * This helper is used by multiple tests to avoid duplicated CREATE TABLE statements.
 */
export function initTestDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_type TEXT,
      identity_id TEXT,
      agent_kind TEXT,
      action_type TEXT NOT NULL,
      target TEXT,
      payload TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0.0,
      timestamp DATETIME DEFAULT (datetime('now'))
    );
  `);
  return db;
}

/**
 * Initialize activity table schema on an existing DatabaseService.
 * Useful for reconnection tests where a new DatabaseService connects to existing data.
 */
export function initActivityTableSchema(db: DatabaseService): void {
  db.instance.exec(ACTIVITY_TABLE_SQL);
}

/**
 * SQL for reviews table (mirrors migrations/001_init.sql; `created_by` since Phase 36)
 */
export const REVIEWS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    portal TEXT,
    branch TEXT NOT NULL,
    repository TEXT NOT NULL,
    base_branch TEXT,
    worktree_path TEXT,
    status TEXT NOT NULL,
    description TEXT NOT NULL,
    commit_sha TEXT,
    files_changed INTEGER DEFAULT 0,
    created TEXT NOT NULL,
    created_by TEXT NOT NULL,
    approved_at TEXT,
    approved_by TEXT,
    rejected_at TEXT,
    rejected_by TEXT,
    rejection_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_trace_id ON reviews(trace_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
  CREATE INDEX IF NOT EXISTS idx_reviews_portal ON reviews(portal);
  CREATE INDEX IF NOT EXISTS idx_reviews_created_by ON reviews(created_by);
  CREATE INDEX IF NOT EXISTS idx_reviews_branch ON reviews(branch);
  CREATE INDEX IF NOT EXISTS idx_reviews_repository ON reviews(repository);
`;

/**
 * SQL for activity_journal table (from migration 001)
 */
export const ACTIVITY_JOURNAL_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS activity_journal (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    target TEXT,
    metadata TEXT,
    timestamp TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activity_journal_trace_id ON activity_journal(trace_id);
  CREATE INDEX IF NOT EXISTS idx_activity_journal_event_type ON activity_journal(event_type);
`;

/**
 * SQL for notifications table (from migration 003)
 */
export const NOTIFICATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    proposal_id TEXT,
    trace_id TEXT,
    created_at TEXT NOT NULL,
    dismissed_at TEXT,
    metadata TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
  CREATE INDEX IF NOT EXISTS idx_notifications_dismissed ON notifications(dismissed_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_proposal ON notifications(proposal_id);
`;

export const PENDING_TOOL_CONFIRMATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS pending_tool_confirmations (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    args_json TEXT NOT NULL,
    step_id TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    approved INTEGER,
    reason TEXT,
    decided_at TEXT,
    decided_by TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pending_tool_confirmations_trace ON pending_tool_confirmations(trace_id);
  CREATE INDEX IF NOT EXISTS idx_pending_tool_confirmations_decided ON pending_tool_confirmations(decided_at);
  CREATE INDEX IF NOT EXISTS idx_pending_tool_confirmations_requested ON pending_tool_confirmations(requested_at);
`;

/**
 * SQL for provider_costs table (from migration 004)
 */
export const PROVIDER_COSTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS provider_costs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    model TEXT,
    trace_id TEXT,
    portal TEXT,
    estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
    cost_source TEXT,
    cache_read_tokens INTEGER,
    cache_creation_tokens INTEGER,
    timestamp DATETIME DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_provider_costs_provider ON provider_costs(provider);
  CREATE INDEX IF NOT EXISTS idx_provider_costs_timestamp ON provider_costs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_provider_costs_trace ON provider_costs(trace_id);
  CREATE INDEX IF NOT EXISTS idx_provider_costs_portal ON provider_costs(portal);
`;

const ARTIFACT_STATUS_CHECK_VALUES = REVIEW_STATUS_VALUES.map((status) => `'${status}'`).join(", ");

export const ARTIFACTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN (${ARTIFACT_STATUS_CHECK_VALUES})),
    type TEXT NOT NULL CHECK (type IN ('analysis', 'report', 'diagram')),
    identity TEXT NOT NULL,
    portal TEXT,
    target_branch TEXT,
    created TEXT NOT NULL,
    updated TEXT,
    request_id TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    rejection_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_artifacts_status ON artifacts(status);
  CREATE INDEX IF NOT EXISTS idx_artifacts_identity ON artifacts(identity);
  CREATE INDEX IF NOT EXISTS idx_artifacts_portal ON artifacts(portal);
  CREATE INDEX IF NOT EXISTS idx_artifacts_request_id ON artifacts(request_id);
  CREATE INDEX IF NOT EXISTS idx_artifacts_created ON artifacts(created DESC);
`;

/**
 * SQL for the Phase 135 Team model-registry tables (mirrors migrations/001_init.sql,
 * §5.2). Lets tests set up the registry schema without hand-writing DDL or running
 * the migration runner.
 */
export const REGISTRY_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS model_catalog (
    provider          TEXT    NOT NULL,
    model             TEXT    NOT NULL,
    display_name      TEXT,
    context_window    INTEGER,
    max_output_tokens INTEGER,
    supports_thinking INTEGER NOT NULL DEFAULT 0,
    supports_effort   INTEGER NOT NULL DEFAULT 0,
    capabilities_json TEXT,
    source            TEXT    NOT NULL,
    refreshed_at      REAL    NOT NULL,
    released_at       REAL,
    PRIMARY KEY (provider, model)
  );
  CREATE TABLE IF NOT EXISTS model_pricing (
    provider          TEXT    NOT NULL,
    model             TEXT    NOT NULL,
    input_per_mtok    REAL,
    output_per_mtok   REAL,
    cache_read_per_mtok  REAL,
    cache_write_per_mtok REAL,
    provenance        TEXT    NOT NULL,
    verified_at       REAL,
    source_url        TEXT,
    PRIMARY KEY (provider, model)
  );
  CREATE TABLE IF NOT EXISTS model_latency (
    provider   TEXT    NOT NULL,
    model      TEXT    NOT NULL,
    latency_ms INTEGER NOT NULL,
    recorded_at REAL    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_latency_lookup ON model_latency (provider, model, recorded_at);
  CREATE TABLE IF NOT EXISTS provider_rate_limit (
    provider   TEXT    NOT NULL PRIMARY KEY,
    remaining  INTEGER NOT NULL,
    max_rpm    INTEGER NOT NULL,
    reset_at   REAL    NOT NULL
  );
  CREATE TABLE IF NOT EXISTS registry_refresh_audit (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    provider      TEXT    NOT NULL,
    kind          TEXT    NOT NULL,
    outcome       TEXT    NOT NULL,
    models_added  INTEGER NOT NULL DEFAULT 0,
    models_removed INTEGER NOT NULL DEFAULT 0,
    started_at    REAL    NOT NULL,
    duration_ms   INTEGER NOT NULL,
    detail        TEXT
  );
  CREATE TABLE IF NOT EXISTS model_benchmark (
    provider        TEXT    NOT NULL,
    model           TEXT    NOT NULL,
    benchmark       TEXT    NOT NULL,
    score           REAL    NOT NULL,
    harness_version TEXT,
    provenance      TEXT    NOT NULL,
    measured_at     REAL    NOT NULL,
    source_url      TEXT,
    PRIMARY KEY (provider, model, benchmark)
  );
  CREATE INDEX IF NOT EXISTS idx_benchmark_rank ON model_benchmark (benchmark, score DESC);
`;

/**
 * Initialize full database schema for integration tests
 */
export function initFullSchema(db: DatabaseService): void {
  db.instance.exec(ACTIVITY_TABLE_SQL);
  db.instance.exec(ACTIVITY_JOURNAL_TABLE_SQL);
  db.instance.exec(REVIEWS_TABLE_SQL);
  db.instance.exec(NOTIFICATIONS_TABLE_SQL);
  db.instance.exec(PENDING_TOOL_CONFIRMATIONS_TABLE_SQL);
  db.instance.exec(PROVIDER_COSTS_TABLE_SQL);
  db.instance.exec(ARTIFACTS_TABLE_SQL);
}

/**
 * Initialize a DatabaseService with an in-memory database for testing.
 * Uses a temporary directory for the config root.
 */
function resolveSqliteLibraryPath(): string | null {
  const candidates = [
    "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0",
    "/usr/lib/x86_64-linux-gnu/libsqlite3.so",
    "/usr/lib/libsqlite3.so.0",
    "/usr/lib/libsqlite3.so",
    "/usr/local/lib/libsqlite3.so.0",
    "/usr/local/lib/libsqlite3.so",
    "/lib/x86_64-linux-gnu/libsqlite3.so.0",
    "/lib/x86_64-linux-gnu/libsqlite3.so",
    "/lib/libsqlite3.so.0",
    "/lib/libsqlite3.so",
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

export async function initTestDbService(): Promise<
  { db: DatabaseService; config: Config; tempDir: string; cleanup: () => Promise<void> }
> {
  if (!Deno.env.get("DENO_SQLITE_PATH")) {
    const sqlitePath = resolveSqliteLibraryPath();
    if (sqlitePath) {
      Deno.env.set("DENO_SQLITE_PATH", sqlitePath);
    }
  }

  const tempDir = await Deno.makeTempDir({ prefix: "exa-test-" });

  const config = createMockConfig(tempDir);

  // Write mock config to disk so subprocesses can load it if passed via CLI or env explicitly
  const configPath = join(tempDir, "exa.config.toml");

  const configContent = `
[system]
root = "${tempDir}"
version = "1.0.0"
log_level = "info"

[database.sqlite]
journal_mode = "WAL"
foreign_keys = true
busy_timeout_ms = 5000

[agents]
default_model = "default"
timeout_sec = 60
max_iterations = 10

[models.default]
provider = "mock"
model = "gpt-5.2-pro"
timeout_ms = 30000
`.trim();
  Deno.writeTextFileSync(configPath, configContent);

  // Create runtime directory (.exa) for journal.db
  await Deno.mkdir(`${tempDir}/${config.paths.runtime}`, { recursive: true });

  const db = new DatabaseService(config);

  // Initialize all tables (activity, activity_journal, reviews, notifications)
  initFullSchema(db);

  return {
    db,
    config,
    tempDir,
    cleanup: async () => {
      try {
        await db.close();
      } catch (_e) {
        // Ignore database close errors during cleanup
      }
      try {
        // Only remove if it's clearly a temporary test directory
        if (tempDir && tempDir.includes("exa-test-")) {
          await Deno.remove(tempDir, { recursive: true });
        }
      } catch (_e) {
        // Ignore directory removal errors during cleanup
      }
    },
  };
}
