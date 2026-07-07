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

export type ConfigValue = string | number | boolean | null;

export interface IConfigOverrideEntry {
  id: number;
  value: ConfigValue;
  source: string;
  swap_class: string;
  created_at: string;
}

const CONFIG_DB_FILE = "config.db";
const CONFIG_DB_DIR = ".exa";

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
}

export function seedConfigDb(db: Database): void {
  const insert = db.prepare(
    "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, NULL, 'init', 'hot')",
  );
  const checkExists = db.prepare(
    "SELECT COUNT(*) as cnt FROM config_overrides WHERE key = ? AND value IS NULL AND source = 'init'",
  );

  for (const [key] of getRegisteredDefaults()) {
    const existing = checkExists.get<{ cnt: number }>(key);
    if (!existing || existing.cnt === 0) {
      insert.run(key);
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

export function insertOverride(
  db: Database,
  key: string,
  value: ConfigValue,
  source: string,
  swapClass: string,
): void {
  const strValue = value === null ? null : String(value);
  db.prepare(
    "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, ?, ?, ?)",
  ).run(key, strValue, source, swapClass);
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
