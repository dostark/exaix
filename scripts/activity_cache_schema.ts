#!/usr/bin/env -S deno run -A
/**
 * @module ActivityCacheSchema
 * @path scripts/activity_cache_schema.ts
 * @description Repairs missing activity cache-token columns when the consolidated
 * initialization migration has already been applied, without rewriting existing rows.
 * @architectural-layer Infrastructure
 * @dependencies [@db/sqlite]
 * @related-files [scripts/setup_db.ts, scripts/migrate_db.ts, migrations/001_init.sql]
 * Usage: imported by setup_db.ts and migrate_db.ts; not a standalone command.
 */

import type { Database } from "@db/sqlite";

interface IActivityColumn {
  name: string;
}

const ACTIVITY_CACHE_COLUMNS: readonly string[] = ["cache_read_tokens", "cache_creation_tokens"];

/** Runs only from explicit database setup/upgrade commands, outside their migration transactions. */
export function upgradeActivityCacheColumns(db: Database): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const columns: IActivityColumn[] = db.prepare("PRAGMA table_info(activity)").all() as IActivityColumn[];
    if (columns.length === 0) throw new Error("Cannot upgrade cache columns: activity table is missing");
    const names: Set<string> = new Set(columns.map((column: IActivityColumn): string => column.name));
    for (const column of ACTIVITY_CACHE_COLUMNS) {
      if (!names.has(column)) db.exec(`ALTER TABLE activity ADD COLUMN ${column} INTEGER`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
