/**
 * @module SchemaUpgradeTestHelper
 * @path tests/scripts/helpers/schema_upgrade_test_helper.ts
 * @description Shared scaffolding for the idempotent activity-schema upgrade tests: run the
 *   real setup/migrate scripts against a temp workspace and assert the migration history.
 * @architectural-layer Testing
 * @related-files [scripts/setup_db.ts, scripts/migrate_db.ts]
 */

import { assertEquals } from "@std/assert";
import { Database } from "@db/sqlite";
import { join } from "@std/path";

export const SCHEMA_UPGRADE_REPO_ROOT: string = Deno.cwd();
export const SCHEMA_UPGRADE_SCRIPT_TIMEOUT_MS: number = 30_000;

/** Runs `scripts/<script>` against `root` with the repo migrations, failing on a nonzero
 *  exit. `migrate_db.ts` runs its `up` command. */
export async function runSchemaUpgradeDbScript(root: string, script: string): Promise<void> {
  const result: Deno.CommandOutput = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--config",
      join(SCHEMA_UPGRADE_REPO_ROOT, "deno.json"),
      "-A",
      join(SCHEMA_UPGRADE_REPO_ROOT, "scripts", script),
      ...(script === "migrate_db.ts" ? ["up"] : []),
    ],
    cwd: root,
    env: { EXA_MIGRATIONS_DIR: join(SCHEMA_UPGRADE_REPO_ROOT, "migrations") },
    signal: AbortSignal.timeout(SCHEMA_UPGRADE_SCRIPT_TIMEOUT_MS),
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
}

/** Opens the migrated journal DB inside `tempDir`. The caller closes it. */
export function openUpgradedJournalDb(tempDir: string): Database {
  return new Database(join(tempDir, ".exa", "journal.db"));
}

/** Asserts the DB recorded exactly the single consolidated init migration. */
export function assertSingleInitMigration(db: Database): void {
  const history = db.prepare("SELECT version FROM schema_migrations ORDER BY id").all();
  assertEquals(history, [{ version: "001_init.sql" }]);
}
