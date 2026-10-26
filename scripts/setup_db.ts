#!/usr/bin/env -S deno run -A
/**
 * @module SetupDB
 * @path scripts/setup_db.ts
 * @description Database initialization script that ensures the schema is up to date in the runtime environment.
 *
 * Usage:
 *   deno run -A scripts/setup_db.ts
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { MigrationDirection } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import {
  extractSql,
  listMigrationFiles,
  prepareMigrationsTable,
  readAppliedMigrations,
  upgradeLegacySchemas,
} from "./migration_support.ts";

/** Env override letting a caller point migrations at the repo while CWD stays the workspace. */
const ENV_MIGRATIONS_DIR = "EXA_MIGRATIONS_DIR";

// Resolve the migrations source directory. The DB always lands in `<cwd>/.exa`, but the
// migrations *source* may differ: a deployable workspace has no `migrations/` dir, so
// `EXA_MIGRATIONS_DIR` lets the scenario framework point at the repo's migrations instead.
export function resolveMigrationsDir(cwd: string, override: Opt<string, Reason.OptionalContext>): string {
  if (override && override.length > 0) return override;
  return join(cwd, "migrations");
}

const ROOT = Deno.cwd();
const RUNTIME_DIR = join(ROOT, ".exa");
const DB_PATH = join(RUNTIME_DIR, "journal.db");
const MIGRATIONS_DIR = resolveMigrationsDir(ROOT, Deno.env.get(ENV_MIGRATIONS_DIR));

async function runMigrations() {
  await ensureDir(RUNTIME_DIR);
  const db = new Database(DB_PATH);

  try {
    prepareMigrationsTable(db);
    const applied = readAppliedMigrations(db);
    const files = await listMigrationFiles(MIGRATIONS_DIR);

    for (const file of files) {
      if (!applied.has(file)) {
        console.log(`Applying migration: ${file}`);
        const content = await Deno.readTextFile(join(MIGRATIONS_DIR, file));
        const upSql = extractSql(content, MigrationDirection.UP);

        db.exec("BEGIN TRANSACTION");
        try {
          db.exec(upSql);
          db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(file);
          db.exec("COMMIT");
          console.log(`✅ Applied ${file}`);
        } catch (err) {
          db.exec("ROLLBACK");
          console.error(`❌ Failed to apply ${file}:`, err);
          throw err;
        }
      }
    }
    upgradeLegacySchemas(db);
    console.log("All migrations up to date.");
  } finally {
    await db.close();
  }
}

async function main() {
  console.log("Initializing Exaix Database...");

  // Ensure System directory exists
  await ensureDir(RUNTIME_DIR);

  // Run migrations directly
  await runMigrations();

  console.log("✅ Database setup complete.");
}

if (import.meta.main) {
  main();
}
