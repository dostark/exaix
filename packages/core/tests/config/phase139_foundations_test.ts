/**
 * @module Phase139FoundationsTest
 * @path packages/core/tests/config/phase139_foundations_test.ts
 * @description Step 1 foundations for Phase 139 (configuring Phase 3): the new
 *   config constants (checksum key, configurable integrity poll interval), the
 *   four co-located config `source` consts in db.ts (GAP-5), the five typed
 *   DomainEventType config events, the ConfigKeyLockedError class, and the three
 *   typed event-payload interfaces (GAP-3).
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { Database } from "@db/sqlite";
import { CONFIG_CHECKSUM_KEY, CONFIG_INTEGRITY_POLL_INTERVAL_MS } from "../../src/types/constants.ts";
import {
  CONFIG_SOURCE_CLI,
  CONFIG_SOURCE_INIT,
  CONFIG_SOURCE_INTEGRITY,
  CONFIG_SOURCE_ROLLBACK,
  insertOverride,
  migrateConfigDb,
} from "../../src/config/db.ts";
import { getRegisteredDefaults } from "../../src/config/registry.ts";
import { DomainEventType } from "../../src/events/domain_event_types.ts";
import { ConfigKeyLockedError } from "../../src/config/errors.ts";
import type { IConfigIntegrityPayload, IConfigLockPayload, IConfigRollbackPayload } from "../../src/config/adapter.ts";

Deno.test("[configuring] constants define CONFIG_CHECKSUM_KEY and a configurable integrity poll interval", () => {
  assertEquals(CONFIG_CHECKSUM_KEY, "_checksum");
  // configurable() returns the default value byte-identical.
  assertEquals(CONFIG_INTEGRITY_POLL_INTERVAL_MS, 60_000);
  // The poll interval is registered as a tunable key.
  const registered = getRegisteredDefaults().get("config.integrity.poll_interval_ms");
  assertEquals(registered !== undefined, true, "integrity poll interval must be a configurable key");
});

Deno.test("[configuring] db.ts exports the four config source consts with expected values (GAP-5)", () => {
  assertEquals(CONFIG_SOURCE_INIT, "init");
  assertEquals(CONFIG_SOURCE_CLI, "cli");
  assertEquals(CONFIG_SOURCE_ROLLBACK, "rollback");
  assertEquals(CONFIG_SOURCE_INTEGRITY, "integrity");
});

Deno.test("[configuring] insertOverride accepts each named source without error (GAP-5)", () => {
  const db = new Database(":memory:");
  try {
    migrateConfigDb(db);
    for (const source of [CONFIG_SOURCE_INIT, CONFIG_SOURCE_CLI, CONFIG_SOURCE_ROLLBACK, CONFIG_SOURCE_INTEGRITY]) {
      insertOverride(db, `test.source.${source}`, "v", source, "hot");
    }
    const count = db.prepare("SELECT COUNT(*) AS cnt FROM config_overrides").get<{ cnt: number }>()?.cnt ?? 0;
    assertEquals(count, 4);
  } finally {
    db.close();
  }
});

Deno.test("[configuring] DomainEventType has the 5 new config event strings with expected values", () => {
  assertEquals(DomainEventType.ConfigRolledBack, "config.rolled_back");
  assertEquals(DomainEventType.ConfigKeyLocked, "config.key_locked");
  assertEquals(DomainEventType.ConfigKeyUnlocked, "config.key_unlocked");
  assertEquals(DomainEventType.ConfigIntegrityVerified, "config.integrity_verified");
  assertEquals(DomainEventType.ConfigIntegrityMismatch, "config.integrity_mismatch");
});

Deno.test("[configuring] ConfigKeyLockedError message includes key and optional reason", () => {
  const noReason = new ConfigKeyLockedError("ai.provider");
  assertEquals(noReason.name, "ConfigKeyLockedError");
  assertStringIncludes(noReason.message, "ai.provider");
  assertStringIncludes(noReason.message, "locked");

  const withReason = new ConfigKeyLockedError("system.root", "compromised — see incident-42");
  assertStringIncludes(withReason.message, "system.root");
  assertStringIncludes(withReason.message, "incident-42");
});

Deno.test("[configuring] typed config event-payload interfaces are shaped as specified (GAP-3)", () => {
  // Compile-time shape assertions — these fail deno check if the interfaces are
  // absent or mis-shaped; the runtime asserts pin the field names.
  const rollback: IConfigRollbackPayload = { key: "ai.timeout_ms", to_id: 3, restored_value: 60_000 };
  const lock: IConfigLockPayload = { key: "ai.provider", locked_by: "cli", reason: null };
  const integrity: IConfigIntegrityPayload = { checksum: "abc", stored: "abc", computed: "abc" };
  assertEquals(rollback.to_id, 3);
  assertEquals(lock.locked_by, "cli");
  assertEquals(integrity.checksum, "abc");
});
