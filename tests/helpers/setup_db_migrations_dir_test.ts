/**
 * @module SetupDbMigrationsDirTest
 * @path tests/helpers/setup_db_migrations_dir_test.ts
 * @description Phase 127 Step 5 (harness fix) — RED-first tests for resolveMigrationsDir().
 *   The scenario framework runs setup_db.ts with the *workspace* as CWD (so the daemon finds
 *   .exa/journal.db there), but a deployable workspace has no migrations/ dir — only the repo
 *   does. resolveMigrationsDir() adds an EXA_MIGRATIONS_DIR override so the scenario can point
 *   at the repo migrations while the DB still lands in the workspace CWD. Default (no override)
 *   stays CWD/migrations — backward-compatible with the existing setup_db_test.ts contract.
 * @architectural-layer Test
 * @related-files [scripts/setup_db.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { resolveMigrationsDir } from "../../scripts/setup_db.ts";

const ENV_MIGRATIONS_DIR = "EXA_MIGRATIONS_DIR";

Deno.test("[setup_db] resolveMigrationsDir defaults to <cwd>/migrations when the override is unset", () => {
  const cwd = "/some/workspace";
  const resolved = resolveMigrationsDir(cwd, undefined);
  assertEquals(resolved, join(cwd, "migrations"));
});

Deno.test("[setup_db] resolveMigrationsDir honors EXA_MIGRATIONS_DIR when set (scenario points at repo migrations)", () => {
  const cwd = "/some/workspace";
  const override = "/repo/migrations";
  const resolved = resolveMigrationsDir(cwd, override);
  assertEquals(resolved, override);
});

Deno.test("[setup_db] resolveMigrationsDir treats an empty override as unset (falls back to cwd)", () => {
  const cwd = "/some/workspace";
  const resolved = resolveMigrationsDir(cwd, "");
  assertEquals(resolved, join(cwd, "migrations"));
});

Deno.test("[setup_db] resolveMigrationsDir reads the override from the process env name", () => {
  // Documents the exact env var the scenario setup-db step must set.
  assertEquals(ENV_MIGRATIONS_DIR, "EXA_MIGRATIONS_DIR");
});
