/**
 * @module ConfigCutoverDaemonBootTest
 * @path tests/integration/config_cutover_daemon_boot_test.ts
 * @description Phase 137 Step 11 (GAP-17 remediation) — RED-first daemon-boot integration
 *   test proving the cutover is WIRED: the real daemon reads a migrated key from the
 *   Config DB through `context.configAdapter` (a DaemonConfigAdapter), not TOML. Seeds a
 *   `ai.timeout_ms` override in the Config DB, boots `apps/daemon/main.ts`, and asserts the
 *   journal shows the daemon resolved that overridden value via the adapter (source=db).
 *   A registration/unit test cannot observe this — only a booted daemon reading the DB can.
 * @architectural-layer Test
 * @related-files [apps/daemon/main.ts, packages/core/src/config/adapter.ts, packages/core/src/config/db.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import { ensureConfigDb, insertOverride, migrateConfigDb, seedConfigDb } from "@exaix/core/config";
import { daemonConfigSections } from "./helpers/daemon_config.ts";

// The migrated key the cutover resolves through the adapter (Phase 137 Step 10).
const CUTOVER_KEY = "ai.timeout_ms";
// A non-default override value so the assertion proves a DB read, not a registry default.
const OVERRIDE_VALUE = 45000;
// The boot event that carries the adapter-resolved value + provenance (Step 11).
const CUTOVER_EVENT = "config.cutover.resolved";

function writeDaemonConfig(configPath: string, root: string): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[ai.mock]",
    "timeout_ms = 30000",
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

/** Seed a Config DB override so the daemon must resolve it through the adapter at boot. */
function seedConfigOverride(root: string, key: string, value: number): void {
  const configDbPath = ensureConfigDb(root);
  const db = new Database(configDbPath);
  try {
    migrateConfigDb(db);
    seedConfigDb(db);
    insertOverride(db, key, value, "cli", "hot");
  } finally {
    db.close();
  }
}

/** Boot the real daemon, let it settle so boot resolution + journalling happen, then SIGTERM. */
async function bootDaemonOnce(configPath: string, settleMs: number): Promise<void> {
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", "apps/daemon/main.ts"],
    stdin: "null",
    stdout: "null",
    stderr: "null",
    env: { EXA_CONFIG_PATH: configPath, EXA_TEST_MODE: "1" },
  }).spawn();
  try {
    await new Promise((r) => setTimeout(r, settleMs));
  } finally {
    try {
      Deno.kill(proc.pid, "SIGTERM");
    } catch { /* already dead */ }
    try {
      await proc.status;
    } catch { /* already finished */ }
  }
}

interface IJournalEvent {
  action_type: string;
  payload: string | null;
}

async function readCutoverEvent(configPath: string): Promise<IJournalEvent | undefined> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    const rows = await db.preparedAll<IJournalEvent>(
      "SELECT action_type, payload FROM activity WHERE action_type = ? ORDER BY rowid DESC LIMIT 1",
      [CUTOVER_EVENT],
    );
    return rows[0];
  } catch {
    return undefined;
  } finally {
    await db.close();
  }
}

Deno.test({
  name:
    "[config_cutover] daemon boot resolves a migrated key (ai.timeout_ms) through the adapter from the Config DB override, not TOML",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "config-cutover-boot-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeDaemonConfig(configPath, tempDir);
    seedConfigOverride(tempDir, CUTOVER_KEY, OVERRIDE_VALUE);
    try {
      await bootDaemonOnce(configPath, 5000);
      const event = await readCutoverEvent(configPath);
      assert(
        event !== undefined,
        `journal must contain ${CUTOVER_EVENT} — proves the daemon read config through context.configAdapter`,
      );
      const payload = JSON.parse(event!.payload ?? "{}") as {
        key?: string;
        value?: number;
        source?: string;
        adapterMode?: string;
      };
      assertEquals(payload.key, CUTOVER_KEY, "cutover event must name the resolved key");
      assertEquals(
        payload.value,
        OVERRIDE_VALUE,
        "resolved value must be the Config DB override (proves DB read, not TOML/registry default)",
      );
      assertEquals(payload.source, "db", "provenance must be the Config DB override");
      assertEquals(payload.adapterMode, "daemon", "resolution must go through the DaemonConfigAdapter");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
