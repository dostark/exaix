/**
 * @module MigrateTestDb
 * @path tests/integration/helpers/migrate_test_db.ts
 * @description Phase 135 Step 9 — runs `scripts/setup_db.ts` as a subprocess against a
 *   test tempdir so a real booted daemon subprocess has a fully migrated `.exa/journal.db`
 *   (production never auto-migrates on boot — see `packages/storage-sqlite/src/database_service.ts`'s
 *   test-mode-only `activity` DDL). Needed by any daemon-boot test that drives a request
 *   past cost tracking (`provider_costs`) or other tables not covered by the test-mode
 *   auto-DDL.
 * @architectural-layer Test
 * @related-files [scripts/setup_db.ts, tests/integration/helpers/daemon_config.ts]
 */

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

/** Run all pending SQL migrations against `<root>/.exa/journal.db`. */
export async function runMigrationsIn(root: string): Promise<void> {
  const proc = new Deno.Command("deno", {
    args: ["run", "-A", `${REPO_ROOT}scripts/setup_db.ts`],
    cwd: root,
    env: { EXA_MIGRATIONS_DIR: `${REPO_ROOT}migrations` },
    stdout: "null",
    stderr: "piped",
  }).spawn();
  const { code, stderr } = await proc.output();
  if (code !== 0) {
    throw new Error(`setup_db.ts failed (exit ${code}): ${new TextDecoder().decode(stderr)}`);
  }
}
