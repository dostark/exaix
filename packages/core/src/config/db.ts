/**
 * @module ConfigDb
 * @path packages/core/src/config/db.ts
 * @description Config DB schema, migrations, and query functions for the
 *   append-only config_overrides table. Uses a dedicated @db/sqlite connection.
 * @architectural-layer Core
 * @related-files ["packages/core/src/config/registry.ts"]
 */
import type { Database } from "@db/sqlite";
import { join } from "@std/path";
import { ensureDirSync } from "@std/fs";
import { getRegisteredDefaults } from "./registry.ts";
import {
  CONFIG_DB_OVERRIDE_HARD_LIMIT,
  CONFIG_DB_OVERRIDE_WARN_THRESHOLD,
  CONFIG_PATTERN_WILDCARD,
} from "../types/constants.ts";
import { ConfigRateLimitedError } from "./errors.ts";
import type { IEventLogger } from "../logger/event_logger.ts";
import type { Opt, Reason } from "../types/optional_marker.ts";

export type ConfigValue = string | number | boolean | null;

export interface IConfigOverrideEntry {
  id: number;
  value: ConfigValue;
  source: string;
  swap_class: string;
  created_at: string;
}

/** A row in the config_mcp_blocklist table (Phase 138 Step 2). */
export interface IBlocklistEntry {
  agent_id: string | null;
  key_pattern: string;
  reason: string | null;
  created_at: string;
}

/** A row in the config_locked_keys table (Phase 139 Step 4). */
export interface ILockedKeyEntry {
  key: string;
  locked_at: string;
  locked_by: string;
  reason: string | null;
}

/**
 * Optional insertOverride settings (Phase 138 Step 3). `hardLimit`/`warnThreshold`
 * overrides exist ONLY so the security test can exercise the DB page-limit
 * rejection branch at a tiny scale (the guard is an anti-DoS control — no
 * legitimate use approaches 1M rows, so seeding 1M real rows would test SQLite,
 * not this logic). Production omits them and uses the real constants.
 */
export interface IInsertOverrideOpts {
  logger?: IEventLogger;
  hardLimit?: number;
  warnThreshold?: number;
}

const CONFIG_DB_FILE = "config.db";
const CONFIG_DB_DIR = ".exa";

// ── Config `source` vocabulary (Phase 139 Step 1, GAP-5) ────────────────────
// All values the `source` column of config_overrides may take, co-located here
// (the Config-DB layer owns the column) rather than split across constants.ts.
/** Seed rows written by seedConfigDb (NULL value, registry default resolves). */
export const CONFIG_SOURCE_INIT = "init";
/** Direct CLI/adapter write. */
export const CONFIG_SOURCE_CLI = "cli";
/** A rollback append restoring a historical value (Phase 139 Step 3). */
export const CONFIG_SOURCE_ROLLBACK = "rollback";
/** The synthetic _checksum row (Phase 139 Step 5). */
export const CONFIG_SOURCE_INTEGRITY = "integrity";

export function ensureConfigDb(rootPath: string): string {
  const dir = join(rootPath, CONFIG_DB_DIR);
  ensureDirSync(dir);
  return join(dir, CONFIG_DB_FILE);
}

export function migrateConfigDb(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS config_overrides (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      key         TEXT NOT NULL,
      value       TEXT,
      source      TEXT NOT NULL DEFAULT 'cli',
      swap_class  TEXT NOT NULL DEFAULT 'hot',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_config_overrides_key ON config_overrides(key, id)",
  );
  // Phase 138 Step 2: deny-permanently blocklist for MCP config writes.
  // agent_id IS NULL means the pattern applies to all agents (admin lock);
  // a non-null agent_id scopes the block to one agent ("deny permanently").
  db.exec(`
    CREATE TABLE IF NOT EXISTS config_mcp_blocklist (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id    TEXT,
      key_pattern TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      reason      TEXT,
      UNIQUE (agent_id, key_pattern)
    )
  `);
  // Phase 139 Step 4: per-key write lock. A locked key is refused by
  // adapter.set() (via assertWritable) across every write surface until unlocked.
  db.exec(`
    CREATE TABLE IF NOT EXISTS config_locked_keys (
      key        TEXT PRIMARY KEY,
      locked_at  TEXT NOT NULL DEFAULT (datetime('now')),
      locked_by  TEXT NOT NULL,
      reason     TEXT
    )
  `);
}

export function seedConfigDb(db: Database): void {
  const insert = db.prepare(
    "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, NULL, ?, 'hot')",
  );
  const checkExists = db.prepare(
    "SELECT COUNT(*) as cnt FROM config_overrides WHERE key = ? AND value IS NULL AND source = ?",
  );

  for (const [key] of getRegisteredDefaults()) {
    const existing = checkExists.get<{ cnt: number }>(key, CONFIG_SOURCE_INIT);
    if (!existing || existing.cnt === 0) {
      insert.run(key, CONFIG_SOURCE_INIT);
    }
  }
}

export function getEffectiveValue(db: Database, key: string): ConfigValue {
  const row = db.prepare(
    "SELECT value FROM config_overrides WHERE key = ? ORDER BY id DESC LIMIT 1",
  ).get<{ value: string | null }>(key);
  return row?.value ?? null;
}

export function getAllEffectiveValues(db: Database): Map<string, ConfigValue> {
  const rows = db.prepare(
    "SELECT key, value FROM config_overrides WHERE id IN (SELECT MAX(id) FROM config_overrides GROUP BY key)",
  ).all<{ key: string; value: string | null }>();
  const result = new Map<string, ConfigValue>();
  for (const row of rows) {
    result.set(row.key, row.value ?? null);
  }
  return result;
}

const CONFIG_DB_OVERRIDE_WARN_EVENT = "config.db.override_threshold";

export function insertOverride(
  db: Database,
  key: string,
  value: ConfigValue,
  source: string,
  swapClass: string,
  opts?: Opt<IInsertOverrideOpts, Reason.OptionalContext>,
): void {
  const logger = opts?.logger;
  const hardLimit = opts?.hardLimit ?? CONFIG_DB_OVERRIDE_HARD_LIMIT;
  const warnThreshold = opts?.warnThreshold ?? CONFIG_DB_OVERRIDE_WARN_THRESHOLD;
  // Phase 138 Step 3: DB page limit (anti-DoS guard). Tombstone (unset) and init
  // writes are exempt so the operator can always recover (unset/rollback/re-seed)
  // even at the hard limit.
  const isRecoveryWrite = value === null || source === CONFIG_SOURCE_INIT;
  const count = db.prepare("SELECT COUNT(*) AS cnt FROM config_overrides")
    .get<{ cnt: number }>()?.cnt ?? 0;
  if (!isRecoveryWrite && count >= hardLimit) {
    throw new ConfigRateLimitedError(
      "db",
      `config_overrides has ${count} rows (hard limit ${hardLimit}); run 'exactl config compact'`,
    );
  }
  if (count >= warnThreshold) {
    logger?.warn(CONFIG_DB_OVERRIDE_WARN_EVENT, null, {
      rows: count,
      threshold: warnThreshold,
    });
  }
  const strValue = value === null ? null : String(value);
  db.prepare(
    "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, ?, ?, ?)",
  ).run(key, strValue, source, swapClass);
}

/**
 * Count `cli`-source config_overrides rows written within the last `windowMs`
 * milliseconds (Phase 138 Step 3 — DB-backed CLI debounce, survives across
 * separate CLI processes).
 */
export function countRecentCliWrites(db: Database, windowMs: number): number {
  const seconds = Math.ceil(windowMs / 1000);
  const row = db.prepare(
    "SELECT COUNT(*) AS cnt FROM config_overrides WHERE source = ? AND created_at >= datetime('now', ?)",
  ).get<{ cnt: number }>(CONFIG_SOURCE_CLI, `-${seconds} seconds`);
  return row?.cnt ?? 0;
}

/**
 * Compact config_overrides to one row per key (the latest, MAX(id)), preserving
 * every effective value. Returns the number of superseded rows removed. The
 * escape hatch referenced by the hard-limit error (Phase 138 Step 3).
 */
export function compactOverrides(db: Database): number {
  const before = db.prepare("SELECT COUNT(*) AS cnt FROM config_overrides")
    .get<{ cnt: number }>()?.cnt ?? 0;
  db.exec(
    "DELETE FROM config_overrides WHERE id NOT IN (SELECT MAX(id) FROM config_overrides GROUP BY key)",
  );
  const after = db.prepare("SELECT COUNT(*) AS cnt FROM config_overrides")
    .get<{ cnt: number }>()?.cnt ?? 0;
  return before - after;
}

/**
 * Get the maximum override ID from the config_overrides table.
 * Used by the polling DB watcher to detect new overrides.
 */
export function getMaxOverrideId(db: Database): number {
  const row = db.prepare(
    "SELECT MAX(id) AS max_id FROM config_overrides",
  ).get<{ max_id: number | null }>();
  return row?.max_id ?? 0;
}

/**
 * Point lookup of a single override row by (key, id) — the rollback target
 * (Phase 139 Step 3). Returns undefined if no row with that id belongs to `key`.
 */
export function getOverrideById(
  db: Database,
  key: string,
  id: number,
): IConfigOverrideEntry | undefined {
  const row = db.prepare(
    "SELECT id, value, source, swap_class, created_at FROM config_overrides WHERE key = ? AND id = ?",
  ).get<{
    id: number;
    value: string | null;
    source: string;
    swap_class: string;
    created_at: string;
  }>(key, id);
  if (!row) return undefined;
  return { ...row, value: row.value ?? null };
}

export function getOverrideHistory(
  db: Database,
  key: string,
): Array<IConfigOverrideEntry> {
  return db.prepare(
    "SELECT id, value, source, swap_class, created_at FROM config_overrides WHERE key = ? ORDER BY id DESC",
  ).all<{
    id: number;
    value: string | null;
    source: string;
    swap_class: string;
    created_at: string;
  }>(key).map((row) => ({
    ...row,
    value: row.value ?? null,
  }));
}

// ── Phase 138 Step 2: config_mcp_blocklist DAO ──────────────────────────────

/**
 * Add a deny-permanently blocklist pattern. `agentId` scopes the block to one
 * agent; omit it (NULL) to block the pattern for all agents. Idempotent on the
 * `(agent_id, key_pattern)` unique key.
 */
export function addBlocklistPattern(
  db: Database,
  pattern: string,
  reason?: Opt<string, Reason.OptionalInput>,
  agentId?: Opt<string, Reason.QueryFilter>,
): void {
  db.prepare(
    "INSERT OR IGNORE INTO config_mcp_blocklist (agent_id, key_pattern, reason) VALUES (?, ?, ?)",
  ).run(agentId ?? null, pattern, reason ?? null);
}

/** Remove a blocklist pattern (optionally scoped to one agent). */
export function removeBlocklistPattern(
  db: Database,
  pattern: string,
  agentId?: Opt<string, Reason.QueryFilter>,
): void {
  if (agentId === undefined) {
    db.prepare(
      "DELETE FROM config_mcp_blocklist WHERE key_pattern = ? AND agent_id IS NULL",
    ).run(pattern);
  } else {
    db.prepare(
      "DELETE FROM config_mcp_blocklist WHERE key_pattern = ? AND agent_id = ?",
    ).run(pattern, agentId);
  }
}

/** List all blocklist patterns, newest first. */
export function listBlocklistPatterns(db: Database): Array<IBlocklistEntry> {
  return db.prepare(
    "SELECT agent_id, key_pattern, reason, created_at FROM config_mcp_blocklist ORDER BY id DESC",
  ).all<{
    agent_id: string | null;
    key_pattern: string;
    reason: string | null;
    created_at: string;
  }>().map((row) => ({
    agent_id: row.agent_id ?? null,
    key_pattern: row.key_pattern,
    reason: row.reason ?? null,
    created_at: row.created_at,
  }));
}

/**
 * Minimal glob match: split the pattern on `*` and require the key to start with
 * the prefix and end with the suffix. A pattern without `*` matches only an equal
 * key. No full wildcard engine — one `*` is the supported form.
 */
export function globMatches(pattern: string, key: string): boolean {
  if (!pattern.includes(CONFIG_PATTERN_WILDCARD)) return pattern === key;
  const [prefix, suffix = ""] = pattern.split(CONFIG_PATTERN_WILDCARD);
  return key.startsWith(prefix) && key.endsWith(suffix) &&
    key.length >= prefix.length + suffix.length;
}

/**
 * True if `key` is blocked for `agentId`. A row with NULL `agent_id` blocks all
 * agents; a row with a matching `agent_id` blocks that agent. Patterns are glob
 * matched via {@link globMatches}.
 */
export function isPathBlocked(
  db: Database,
  key: string,
  agentId?: Opt<string, Reason.QueryFilter>,
): boolean {
  const rows = db.prepare(
    "SELECT agent_id, key_pattern FROM config_mcp_blocklist WHERE agent_id IS NULL OR agent_id = ?",
  ).all<{ agent_id: string | null; key_pattern: string }>(agentId ?? null);
  return rows.some((row) => globMatches(row.key_pattern, key));
}

// ── Phase 139 Step 4: config_locked_keys DAO ────────────────────────────────

/** Lock `key` against writes. Idempotent on the `key` PRIMARY KEY (re-lock updates the row). */
export function lockKey(
  db: Database,
  key: string,
  lockedBy: string,
  reason?: Opt<string, Reason.OptionalInput>,
): void {
  db.prepare(
    "INSERT INTO config_locked_keys (key, locked_by, reason) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET locked_by = excluded.locked_by, reason = excluded.reason, locked_at = datetime('now')",
  ).run(key, lockedBy, reason ?? null);
}

/** Remove the lock on `key` (idempotent — no-op if not locked). */
export function unlockKey(db: Database, key: string): void {
  db.prepare("DELETE FROM config_locked_keys WHERE key = ?").run(key);
}

/** True if `key` is in config_locked_keys. */
export function isKeyLocked(db: Database, key: string): boolean {
  const row = db.prepare("SELECT 1 AS one FROM config_locked_keys WHERE key = ?").get<{ one: number }>(key);
  return row !== undefined;
}

/** List all locked keys, newest lock first. */
export function listLockedKeys(db: Database): Array<ILockedKeyEntry> {
  return db.prepare(
    "SELECT key, locked_at, locked_by, reason FROM config_locked_keys ORDER BY locked_at DESC",
  ).all<{
    key: string;
    locked_at: string;
    locked_by: string;
    reason: string | null;
  }>().map((row) => ({
    key: row.key,
    locked_at: row.locked_at,
    locked_by: row.locked_by,
    reason: row.reason ?? null,
  }));
}
