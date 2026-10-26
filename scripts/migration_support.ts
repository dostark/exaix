#!/usr/bin/env -S deno run -A
/**
 * @module MigrationSupport
 * @path scripts/migration_support.ts
 * @description Migration bookkeeping shared by the database setup and migration scripts.
 * @architectural-layer Infrastructure
 * @dependencies [@db/sqlite, @exaix/core]
 * @related-files [scripts/setup_db.ts, scripts/migrate_db.ts]
 * Usage: imported by setup_db.ts and migrate_db.ts; not a standalone command.
 */

import type { Database } from "@db/sqlite";
import type { MigrationDirection } from "@exaix/core";
import { upgradeActivityCacheColumns } from "./activity_cache_schema.ts";
import { upgradeActivityChainColumns } from "./journal_integrity_schema.ts";
import { upgradeProviderCostsIdentityColumns } from "./provider_costs_schema.ts";
import { upgradeSkillJournalSchema } from "./skill_journal_schema.ts";

const SQL_EXTENSION = ".sql";

/** Sets the PRAGMAs and creates the migrations table. Call it outside a transaction. */
export function prepareMigrationsTable(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT (datetime('now'))
      );
    `);
}

/** Reads the versions that the migrations table records, in the order they were applied. */
export function readAppliedMigrations(db: Database): Set<string> {
  const appliedRows = db.prepare("SELECT version FROM schema_migrations ORDER BY id ASC").all() as Array<
    { version: string }
  >;
  return new Set(appliedRows.map((row) => row.version));
}

/** Lists the migration files of a directory, sorted by name. */
export async function listMigrationFiles(migrationsDir: string): Promise<string[]> {
  const files = [];
  for await (const entry of Deno.readDir(migrationsDir)) {
    if (entry.isFile && entry.name.endsWith(SQL_EXTENSION)) {
      files.push(entry.name);
    }
  }
  files.sort();
  return files;
}

/** Repairs the columns that the consolidated initial migration may predate. */
export function upgradeLegacySchemas(db: Database): void {
  upgradeActivityCacheColumns(db);
  upgradeActivityChainColumns(db);
  upgradeProviderCostsIdentityColumns(db);
  upgradeSkillJournalSchema(db);
}

/** Returns the SQL of one section of a migration file. */
export function extractSql(content: string, type: MigrationDirection): string {
  const lines = content.split("\n");
  let sql = "";
  let capturing = false;

  for (const line of lines) {
    if (line.trim().startsWith(`-- ${type}`)) {
      capturing = true;
      continue;
    }
    if (line.trim().startsWith("-- ") && (line.includes("up") || line.includes("down"))) {
      if (capturing) break; // Stop if we hit the next section
    }
    if (capturing) {
      sql += line + "\n";
    }
  }
  return sql;
}
