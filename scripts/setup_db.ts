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
import { MigrationDirection } from "../src/shared/enums.ts";

const ROOT = Deno.cwd();
const RUNTIME_DIR = join(ROOT, ".exa");
const DB_PATH = join(RUNTIME_DIR, "journal.db");
const MIGRATIONS_DIR = join(ROOT, "migrations");

async function runMigrations() {
  await ensureDir(RUNTIME_DIR);
  const db = new Database(DB_PATH);

  try {
    // Ensure migrations table exists and set PRAGMAs (must be outside transaction)
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT (datetime('now'))
      );
    `);

    // Get applied migrations
    const appliedRows = db.prepare("SELECT version FROM schema_migrations ORDER BY id ASC").all() as Array<
      { version: string }
    >;
    const applied = new Set(appliedRows.map((row) => row.version));

    // Get available migrations
    const files = [];
    for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
      if (entry.isFile && entry.name.endsWith(".sql")) {
        files.push(entry.name);
      }
    }
    files.sort();

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
    console.log("All migrations up to date.");
  } finally {
    await db.close();
  }
}

function extractSql(content: string, type: MigrationDirection): string {
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
