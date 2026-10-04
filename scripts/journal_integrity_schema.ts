#!/usr/bin/env -S deno run -A
/**
 * @module JournalIntegritySchema
 * @path scripts/journal_integrity_schema.ts
 * @description Repairs the activity hash-chain columns when the consolidated
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

const ACTIVITY_CHAIN_COLUMNS: readonly string[] = ["prev_hash", "row_hash"];

/** Runs only from explicit database setup/upgrade commands, outside their migration transactions. */
export function upgradeActivityChainColumns(db: Database): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const columns: IActivityColumn[] = db.prepare("PRAGMA table_info(activity)").all() as IActivityColumn[];
    if (columns.length === 0) throw new Error("Cannot upgrade chain columns: activity table is missing");
    const names: Set<string> = new Set(columns.map((column: IActivityColumn): string => column.name));
    for (const column of ACTIVITY_CHAIN_COLUMNS) {
      if (!names.has(column)) db.exec(`ALTER TABLE activity ADD COLUMN ${column} TEXT`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
