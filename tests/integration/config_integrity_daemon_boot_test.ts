/**
 * @module ConfigIntegrityDaemonBootTest
 * @path tests/integration/config_integrity_daemon_boot_test.ts
 * @description Phase 139 Step 7 — daemon-boot integration tests proving the
 *   integrity checksum is verified at boot and on periodic poll:
 *   (1) a clean daemon boot journals `config.integrity_verified`,
 *   (2) an out-of-band edit (raw sqlite3 bypassing the adapter) is detected
 *       at boot as `config.integrity_mismatch`,
 *   (3) the periodic verify hook fires on the existing poll loop and detects
 *       a runtime out-of-band edit as `config.integrity_mismatch`.
 *   Only a real booted daemon reading the Config DB can observe these — a
 *   unit-constructed adapter cannot replicate the boot/poll lifecycle.
 * @architectural-layer Test
 * @related-files [apps/daemon/main.ts, packages/core/src/config/adapter.ts, packages/core/src/config/db.ts]
 */
import { assert } from "@std/assert";
import { Database } from "@db/sqlite";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import {
  CONFIG_SOURCE_INTEGRITY,
  ensureConfigDb,
  insertOverride,
  migrateConfigDb,
  seedConfigDb,
} from "@exaix/core/config";
import { CONFIG_CHECKSUM_KEY } from "@exaix/core/types";
import { bootRealDaemon, writeDaemonConfigWithMockAi } from "./helpers/daemon_config.ts";
import { join } from "@std/path";

const VERIFIED_EVENT = "config.integrity_verified";
const MISMATCH_EVENT = "config.integrity_mismatch";

async function hasJournalEvent(configPath: string, action: string): Promise<boolean> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    const rows = await db.preparedAll<{ n: number }>(
      "SELECT COUNT(*) AS n FROM activity WHERE action_type = ?",
      [action],
    );
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  } finally {
    await db.close();
  }
}

/** Seed a config DB with registry init + one override so the checksum has non-trivial content. */
function seedConfigDbTable(root: string): void {
  const configDbPath = ensureConfigDb(root);
  const db = new Database(configDbPath);
  try {
    migrateConfigDb(db);
    seedConfigDb(db);
    insertOverride(db, "ai.timeout_ms", 40000, "cli", "hot");
  } finally {
    db.close();
  }
}

/** Corrupt the stored _checksum row to simulate an out-of-band tamper. */
function corruptChecksum(root: string): void {
  const configDbPath = ensureConfigDb(root);
  const db = new Database(configDbPath);
  try {
    db.prepare("UPDATE config_overrides SET value = 'deadbeef' WHERE key = ? AND source = ?")
      .run(CONFIG_CHECKSUM_KEY, CONFIG_SOURCE_INTEGRITY);
  } finally {
    db.close();
  }
}

/** Append an out-of-band override row (bypassing the adapter) to trigger a checksum mismatch. */
function appendOutOfBandOverride(root: string, key: string, value: number): void {
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
  name: "[configuring-integrity] new daemon boot seeds + journals config.integrity_verified when config is clean",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "integrity-boot-clean-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeDaemonConfigWithMockAi(configPath, tempDir);
    seedConfigDbTable(tempDir);
    try {
      await bootRealDaemon(configPath, 4000);
      assert(
        await hasJournalEvent(configPath, VERIFIED_EVENT),
        `journal must contain ${VERIFIED_EVENT} — proves the daemon verified integrity at boot`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "[configuring-integrity] daemon boot journals config.integrity_mismatch after an out-of-band checksum tamper",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "integrity-boot-tamper-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeDaemonConfigWithMockAi(configPath, tempDir);
    seedConfigDbTable(tempDir);

    // Boot once to seed the checksum, then tamper, then boot again to detect.
    try {
      await bootRealDaemon(configPath, 4000);
      corruptChecksum(tempDir);
      await bootRealDaemon(configPath, 4000);
      assert(
        await hasJournalEvent(configPath, MISMATCH_EVENT),
        `journal must contain ${MISMATCH_EVENT} — proves the daemon detected an out-of-band checksum tamper at boot`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "[configuring-integrity] the running daemon detects a mid-flight out-of-band override as config.integrity_mismatch on the periodic poll",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "integrity-poll-tamper-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeDaemonConfigWithMockAi(configPath, tempDir);
    seedConfigDbTable(tempDir);
    try {
      // Boot with short poll intervals; mid-flight inject causes periodic verify to detect mismatch.
      await bootRealDaemon(configPath, 2000, {
        extraEnv: {
          EXA_CONFIG_DB_POLL_INTERVAL_MS: "300",
          EXA_INTEGRITY_POLL_INTERVAL_MS: "300",
        },
        midFlight: () => appendOutOfBandOverride(tempDir, "ai.max_tokens", 9999),
        afterInjectMs: 2000,
      });
      assert(
        await hasJournalEvent(configPath, MISMATCH_EVENT),
        `journal must contain ${MISMATCH_EVENT} — proves the periodic integrity poll detected the out-of-band edit`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
