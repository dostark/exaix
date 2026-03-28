/**
 * @module DatabaseSetupTest
 * @path tests/setup_db_test.ts
 * @description Verifies the database initialization logic, ensuring that the primary journal
 * and activity tables are correctly created during project bootstrap.
 */

import { assert } from "https://deno.land/std@0.201.0/testing/asserts.ts";
import { dirname, fromFileUrl, join } from "https://deno.land/std@0.201.0/path/mod.ts";
import { getRuntimeDir } from "./helpers/paths_helper.ts";

// Resolve repository root (two levels up from this test file)
const __dirname = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// Helper to list columns for a table using sqlite3 CLI
async function tableColumns(dbPath: string, table: string) {
  const q = `PRAGMA table_info('${table}');`;
  const ccmd = new Deno.Command("sqlite3", {
    args: [dbPath, q],
    stdout: "piped",
    stderr: "piped",
  });
  const cres = await ccmd.output();
  const cout = new TextDecoder().decode(cres.stdout || new Uint8Array());
  // each line: cid|name|type|notnull|dflt_value|pk
  return cout.split(/\r?\n/).map((l) => l.split("|")[1]).filter(Boolean);
}

Deno.test("setup_db.ts initializes journal.db with expected tables", async () => {
  // Create an isolated temporary workspace and run the setup script inside it
  const tmp = await Deno.makeTempDir({ prefix: "exaix-test-" });
  try {
    const scriptPath = join(REPO_ROOT, "scripts", "setup_db.ts");

    // Copy necessary files to temp workspace so `deno task migrate` works
    await Deno.copyFile(
      join(REPO_ROOT, "deno.json"),
      join(tmp, "deno.json"),
    );

    // Copy scripts directory
    await Deno.mkdir(join(tmp, "scripts"), { recursive: true });
    await Deno.copyFile(
      join(REPO_ROOT, "scripts", "setup_db.ts"),
      join(tmp, "scripts", "setup_db.ts"),
    );
    await Deno.copyFile(
      join(REPO_ROOT, "scripts", "migrate_db.ts"),
      join(tmp, "scripts", "migrate_db.ts"),
    );

    // Copy migrations directory
    await Deno.mkdir(join(tmp, "migrations"), { recursive: true });
    for await (const entry of Deno.readDir(join(REPO_ROOT, "migrations"))) {
      if (entry.isFile) {
        await Deno.copyFile(
          join(REPO_ROOT, "migrations", entry.name),
          join(tmp, "migrations", entry.name),
        );
      }
    }

    // Run the script using deno with required permissions
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-run",
        "--allow-env",
        "--allow-ffi",
        scriptPath,
      ],
      cwd: tmp,
      stdout: "piped",
      stderr: "piped",
    });

    const res = await cmd.output();
    const out = new TextDecoder().decode(res.stdout || new Uint8Array());
    const err = new TextDecoder().decode(res.stderr || new Uint8Array());

    if (res.code !== 0) {
      console.error("setup_db failed stdout:\n", out);
      console.error("setup_db failed stderr:\n", err);
    }

    assert(res.code === 0, `setup_db.ts exited with code ${res.code}: ${err}`);

    const dbPath = join(getRuntimeDir(tmp), "journal.db");
    // Verify DB file exists
    const stat = await Deno.stat(dbPath);
    assert(stat.isFile, "journal.db was not created");

    // Prefer using sqlite3 CLI to inspect tables to avoid loading wasm sqlite in test runtime
    let sqliteAvailable = true;
    try {
      const ver = await new Deno.Command("sqlite3", { args: ["--version"] }).output();
      if (ver.code !== 0) sqliteAvailable = false;
    } catch {
      sqliteAvailable = false;
    }

    if (sqliteAvailable) {
      const q = "SELECT name FROM sqlite_master WHERE type='table';";
      const cmd = new Deno.Command("sqlite3", {
        args: [dbPath, q],
        stdout: "piped",
        stderr: "piped",
      });
      const res = await cmd.output();
      const out = new TextDecoder().decode(res.stdout || new Uint8Array());
      const err = new TextDecoder().decode(res.stderr || new Uint8Array());
      if (res.code !== 0) {
        console.error("sqlite3 query failed stderr:\n", err);
      }
      assert(res.code === 0, `sqlite3 exited with code ${res.code}: ${err}`);
      const rows = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      // Expect core tables to be present
      assert(rows.includes("activity"));
      assert(rows.includes("leases"));
      assert(rows.includes("schema_migrations"));

      const activityCols = await tableColumns(dbPath, "activity");
      assert(activityCols.includes("id"));
      assert(activityCols.includes("trace_id"));
      assert(activityCols.includes("actor"));
      assert(activityCols.includes("payload"));

      const leasesCols = await tableColumns(dbPath, "leases");
      assert(leasesCols.includes("file_path"));
      assert(leasesCols.includes("identity_id"));
      assert(leasesCols.includes("expires_at"));

      const schemaCols = await tableColumns(dbPath, "schema_migrations");
      assert(schemaCols.includes("version"));

      // Verify indexes exist
      const idxQ = "SELECT name FROM sqlite_master WHERE type='index';";
      const idxCmd = new Deno.Command("sqlite3", {
        args: [dbPath, idxQ],
        stdout: "piped",
        stderr: "piped",
      });
      const idxRes = await idxCmd.output();
      const idxOut = new TextDecoder().decode(idxRes.stdout || new Uint8Array());
      const idxRows = idxOut.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      assert(idxRows.includes("idx_activity_trace"));
      assert(idxRows.includes("idx_activity_time"));
      assert(idxRows.includes("idx_activity_actor"));
      assert(idxRows.includes("idx_leases_expires"));
    } else {
      // If sqlite3 CLI not available, at least ensure file has non-zero size
      assert(
        stat.size > 0,
        "journal.db is empty and sqlite3 CLI is not available to inspect schema",
      );
    }
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});
