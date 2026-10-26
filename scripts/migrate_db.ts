#!/usr/bin/env -S deno run -A
/**
 * @module MigrateDB
 * @path scripts/migrate_db.ts
 * @description Database migration runner for applying and reverting schema changes.
 *
 * Usage:
 *   deno run -A scripts/migrate_db.ts [up|down|status]
 */
import { Database } from "@db/sqlite";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { MigrationDirection } from "@exaix/core";
import {
  extractSql,
  listMigrationFiles,
  prepareMigrationsTable,
  readAppliedMigrations,
  upgradeLegacySchemas,
} from "./migration_support.ts";

import { ConfigService } from "@exaix/core/config";

const configService = new ConfigService();
const cfg = configService.get();

const ROOT = Deno.cwd();
const RUNTIME_DIR = join(cfg.system.root!, cfg.paths.runtime!);
const DB_PATH = join(RUNTIME_DIR, "journal.db");
const MIGRATIONS_DIR = join(ROOT, "migrations");

async function main() {
  const args = Deno.args;
  const command = args[0];

  if (command !== MigrationDirection.UP && command !== MigrationDirection.DOWN) {
    console.error("Usage: deno task migrate [up|down]");
    Deno.exit(1);
  }

  await ensureDir(RUNTIME_DIR);
  const db = new Database(DB_PATH);

  try {
    prepareMigrationsTable(db);
    const applied = readAppliedMigrations(db);
    const files = await listMigrationFiles(MIGRATIONS_DIR);

    if (command === MigrationDirection.UP) {
      for (const file of files) {
        if (!applied.has(file)) {
          console.log(`Applying migration: ${file}`);
          const content = await Deno.readTextFile(join(MIGRATIONS_DIR, file));
          const upSql = extractSql(content, MigrationDirection.UP);

          db.exec("BEGIN TRANSACTION");
          try {
            db.exec(upSql);

            // Validate migration was applied correctly
            const validationResult = validateMigration(file, db);
            if (!validationResult.success) {
              throw new Error(`Migration validation failed: ${validationResult.error}`);
            }

            db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(file);
            db.exec("COMMIT");
            console.log(`✅ Applied and validated ${file}`);
          } catch (err) {
            db.exec("ROLLBACK");
            console.error(`❌ Failed to apply ${file}:`, err);
            Deno.exit(1);
          }
        }
      }
      upgradeLegacySchemas(db);
      console.log("All migrations up to date.");
    } else if (command === MigrationDirection.DOWN) {
      const lastApplied = Array.from(applied).pop();
      if (!lastApplied) {
        console.log("No migrations to revert.");
        return;
      }

      console.log(`Reverting migration: ${lastApplied}`);
      const content = await Deno.readTextFile(join(MIGRATIONS_DIR, lastApplied));
      const downSql = extractSql(content, MigrationDirection.DOWN);

      db.exec("BEGIN TRANSACTION");
      try {
        db.exec(downSql);
        db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(lastApplied);
        db.exec("COMMIT");
        console.log(`✅ Reverted ${lastApplied}`);
      } catch (err) {
        db.exec("ROLLBACK");
        console.error(`❌ Failed to revert ${lastApplied}:`, err);
        Deno.exit(1);
      }
    }
  } finally {
    await db.close();
  }
}

interface IValidationResult {
  success: boolean;
  error?: string;
}

function validateMigration(migrationFile: string, db: Database): IValidationResult {
  switch (migrationFile) {
    case "001_init.sql": {
      // Check that all tables exist. 001 is the whole schema — core tables plus the Team
      // model-registry tables that used to live in the since-folded-in 002.
      const tables = [
        "activity",
        "leases",
        "reviews",
        "notifications",
        "pending_tool_confirmations",
        "provider_costs",
        "artifacts",
        "model_catalog",
        "model_pricing",
        "model_latency",
        "provider_rate_limit",
        "registry_refresh_audit",
        "model_benchmark",
        "skill_revisions",
        "skill_usage",
        "skill_revision_scopes",
      ];
      for (const table of tables) {
        const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (!result) {
          return { success: false, error: `Table '${table}' was not created` };
        }
      }

      // Check that required indexes exist
      const indexes = [
        "idx_activity_trace",
        "idx_activity_agent_role",
        "idx_activity_actor_type",
        "idx_activity_runner_kind",
        "idx_leases_agent_role",
        "idx_reviews_trace_id",
        "idx_reviews_status",
        "idx_reviews_portal",
        "idx_reviews_created_by",
        "idx_reviews_branch",
        "idx_provider_costs_provider",
        "idx_provider_costs_timestamp",
        "idx_artifacts_status",
        "idx_artifacts_agent_role",
        "idx_latency_lookup",
        "idx_benchmark_rank",
        "idx_skill_revisions_name",
        "idx_skill_usage_name",
        "idx_skill_usage_trace",
      ];
      for (const index of indexes) {
        const indexExists = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(index);
        if (!indexExists) {
          return { success: false, error: `Index '${index}' was not created` };
        }
      }
      return { success: true };
    }

    default: {
      // For unknown migrations, just check database is still accessible
      try {
        db.prepare("SELECT 1").get();
        return { success: true };
      } catch (err) {
        return { success: false, error: `Database became inaccessible after migration: ${err}` };
      }
    }
  }
}

if (import.meta.main) {
  main();
}
