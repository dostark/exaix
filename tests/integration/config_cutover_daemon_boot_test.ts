/**
 * @module ConfigCutoverDaemonBootTest
 * @path tests/integration/config_cutover_daemon_boot_test.ts
 * @description Phase 137 Steps 11 & 14 (GAP-17 / GAP-20) — daemon-boot integration tests
 *   proving the cutover is WIRED end-to-end against the REAL daemon:
 *   (1) boot resolves a migrated key (`ai.timeout_ms`) from the Config DB through
 *       `context.configAdapter` (a DaemonConfigAdapter), not TOML — asserted via the
 *       `config.cutover.resolved` journal event (value/source/adapterMode).
 *   (2) the running daemon hot-applies an EXTERNAL Config DB override via the poll watcher
 *       (short interval in test mode) — asserted via `config.db_watcher.change_detected`.
 *   A registration/unit test cannot observe either — only a booted daemon reading the DB can.
 * @architectural-layer Test
 * @related-files [apps/daemon/main.ts, packages/core/src/config/adapter.ts, packages/core/src/config/db.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import { hasJournalEvent } from "./helpers/config_daemon_test_helpers.ts";
import { ensureConfigDb, insertOverride, migrateConfigDb, seedConfigDb } from "@exaix/core/config";
import { bootRealDaemon, writeDaemonConfigWithMockAi } from "./helpers/daemon_config.ts";

// The migrated key the cutover resolves through the adapter.
const CUTOVER_KEY = "ai.timeout_ms";
// A non-default override value so the assertion proves a DB read, not a registry default.
const OVERRIDE_VALUE = 45000;
// The boot event that carries the adapter-resolved value + provenance.
const CUTOVER_EVENT = "config.cutover.resolved";
// The watcher event emitted when an external override is hot-applied.
const WATCHER_CHANGE_EVENT = "config.db_watcher.change_detected";
// Short poll interval (ms) so the watcher fires within a test-length boot.
const TEST_POLL_INTERVAL_MS = "300";

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

/** Append an external override to an already-initialized Config DB (simulates a CLI write). */
function appendConfigOverride(root: string, key: string, value: number): void {
  const configDbPath = ensureConfigDb(root);
  const db = new Database(configDbPath);
  try {
    migrateConfigDb(db);
    insertOverride(db, key, value, "cli", "hot");
  } finally {
    db.close();
  }
}

Deno.test({
  name:
    "[configuring-cutover] daemon boot resolves a migrated key (ai.timeout_ms) through the adapter from the Config DB override, not TOML",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "config-cutover-boot-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeDaemonConfigWithMockAi(configPath, tempDir);
    seedConfigOverride(tempDir, CUTOVER_KEY, OVERRIDE_VALUE);
    try {
      await bootRealDaemon(configPath, 5000);
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

Deno.test({
  name: "[configuring-cutover] the running daemon hot-applies an external Config DB override via the poll watcher",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "config-cutover-poll-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeDaemonConfigWithMockAi(configPath, tempDir);
    // Seed the DB (registry init rows) so the daemon boots with a store; no CUTOVER_KEY
    // override yet — the watcher must pick up the LATER external write.
    seedConfigOverride(tempDir, "ai.retry.max_attempts", 5);
    try {
      await bootRealDaemon(configPath, 1500, {
        extraEnv: { EXA_CONFIG_DB_POLL_INTERVAL_MS: TEST_POLL_INTERVAL_MS },
        midFlight: () => appendConfigOverride(tempDir, CUTOVER_KEY, OVERRIDE_VALUE),
        afterInjectMs: 1500, // give the 300ms poll several cycles to detect + hot-apply
      });
      assert(
        await hasJournalEvent(configPath, WATCHER_CHANGE_EVENT),
        `journal must contain ${WATCHER_CHANGE_EVENT} — proves the poll watcher detected and ` +
          `hot-applied the external override into the running daemon's in-memory store`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
