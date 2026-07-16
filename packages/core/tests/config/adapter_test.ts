/**
 * @module ConfigAdapterTest
 * @path packages/core/tests/config/adapter_test.ts
 * @description Tests for DirectConfigAdapter and createConfigAdapter factory.
 */
import { Database } from "@db/sqlite";
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { configurable } from "../../src/config/registry.ts";
import { ConfigProvenanceSource, ConfigValueType } from "../../src/types/enums.ts";
import { CONFIG_CHECKSUM_KEY } from "../../src/types/constants.ts";
import { addBlocklistPattern, ensureConfigDb, migrateConfigDb, seedConfigDb } from "../../src/config/db.ts";
import { createConfigAdapter, DirectConfigAdapter } from "../../src/config/adapter.ts";
import { ConfigKeyLockedError, ConfigKeyNotFoundError, ConfigRateLimitedError } from "../../src/config/errors.ts";
import { DomainEventType } from "../../src/events/domain_event_types.ts";
import type { IEventLogger } from "../../src/logger/event_logger.ts";
import type { ILogEvent } from "../../src/types/i_log_event.ts";
import type { LogMetadata } from "../../src/types/json.ts";

interface ICapturedEvent {
  action: string;
  target: string | null;
  payload?: LogMetadata;
}

/** Minimal spy logger capturing info() calls for audit-trail assertions. */
function createSpyLogger(): { logger: IEventLogger; events: ICapturedEvent[] } {
  const events: ICapturedEvent[] = [];
  const logger: IEventLogger = {
    log: () => Promise.resolve(),
    info: (action, target, payload) => {
      events.push({ action, target, payload });
      return Promise.resolve();
    },
    warn: (action, target, payload) => {
      events.push({ action, target, payload });
      return Promise.resolve();
    },
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    child: (_overrides: Partial<ILogEvent>) => logger,
  };
  return { logger, events };
}

// Module-level test key registration (runs once when module loads)
configurable({
  key: "adapter_test.timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Adapter test timeout",
  min: 1000,
  max: 120000,
});
configurable({
  key: "adapter_test.greeting",
  default: "hello",
  type: ConfigValueType.STRING,
  description: "Adapter test greeting",
  enum: ["hello", "hi", "hey"] as readonly string[],
});
configurable({
  key: "adapter_test.enabled",
  default: true,
  type: ConfigValueType.BOOLEAN,
  description: "Adapter test enabled flag",
});
configurable({
  key: "adapter_test.log_level",
  default: "info",
  type: ConfigValueType.STRING,
  description: "Adapter test log level",
});
configurable({
  key: "adapter_test.port",
  default: 8080,
  type: ConfigValueType.NUMBER,
  description: "Adapter test port",
});
// Pattern key for namespaced-validation tests (GAP-11/12): matches
// `adapter_test.models.<name>.model`.
configurable({
  key: "adapter_test.models.*.model",
  default: "",
  type: ConfigValueType.STRING,
  description: "Adapter test per-name model pattern",
});

function setupAdapter(): {
  adapter: DirectConfigAdapter;
  dir: string;
} {
  const dir = Deno.makeTempDirSync({ prefix: "adapter-test-" });
  const dbPath = ensureConfigDb(dir);
  const db = new Database(dbPath);
  try {
    migrateConfigDb(db);
    seedConfigDb(db);
  } finally {
    db.close();
  }
  const adapter = new DirectConfigAdapter(dbPath);
  return { adapter, dir };
}

function cleanUp(dir: string): void {
  Deno.removeSync(dir, { recursive: true });
}

Deno.test(
  "[configuring] DirectConfigAdapter.get returns registry default when no override",
  () => {
    const { adapter, dir } = setupAdapter();
    try {
      assertEquals(adapter.get("adapter_test.timeout_ms"), 30000);
    } finally {
      cleanUp(dir);
    }
  },
);

Deno.test("[configuring] DirectConfigAdapter.get returns DB override when set", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    await adapter.set("adapter_test.timeout_ms", 60000);
    assertEquals(adapter.get("adapter_test.timeout_ms"), 60000);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] DirectConfigAdapter.get returns undefined for unknown key", () => {
  const { adapter, dir } = setupAdapter();
  try {
    assertEquals(adapter.get("nonexistent.key"), undefined);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] DirectConfigAdapter.unset reverts to registry default", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    await adapter.set("adapter_test.greeting", "hey");
    assertEquals(adapter.get("adapter_test.greeting"), "hey");
    await adapter.unset("adapter_test.greeting");
    assertEquals(adapter.get("adapter_test.greeting"), "hello");
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] DirectConfigAdapter.validateAtPath rejects invalid type", () => {
  const { adapter, dir } = setupAdapter();
  try {
    const report = adapter.validateAtPath(
      "adapter_test.timeout_ms",
      "not_a_number",
    );
    assertEquals(report.valid, false);
    assertEquals(report.issues.length >= 1, true);
    assertEquals(report.issues[0].path, "adapter_test.timeout_ms");
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] DirectConfigAdapter.validateAtPath rejects out-of-bounds", () => {
  const { adapter, dir } = setupAdapter();
  try {
    const report = adapter.validateAtPath("adapter_test.timeout_ms", 999999);
    assertEquals(report.valid, false);
    assertEquals(report.issues.length >= 1, true);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] DirectConfigAdapter.validateAtPath rejects invalid enum", () => {
  const { adapter, dir } = setupAdapter();
  try {
    const report = adapter.validateAtPath(
      "adapter_test.greeting",
      "goodbye",
    );
    assertEquals(report.valid, false);
    assertEquals(report.issues.length >= 1, true);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] DirectConfigAdapter.listOverrides returns only explicitly set keys", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    await adapter.set("adapter_test.timeout_ms", 50000);
    const overrides = adapter.listOverrides();
    assertEquals(overrides.length, 1);
    assertEquals(overrides[0].key, "adapter_test.timeout_ms");
    assertEquals(overrides[0].value, 50000);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] DirectConfigAdapter.diff shows overridden keys", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    await adapter.set("adapter_test.timeout_ms", 99999);
    const diff = adapter.diff();
    assertEquals(diff.overridden.length >= 1, true);
    const match = diff.overridden.find(
      (d) => d.path === "adapter_test.timeout_ms",
    );
    assertNotEquals(match, undefined);
    assertEquals(match?.current, 99999);
    assertEquals(match?.default, 30000);
  } finally {
    cleanUp(dir);
  }
});

Deno.test(
  "[configuring] DirectConfigAdapter.getProvenance returns source=db for overridden key",
  async () => {
    const { adapter, dir } = setupAdapter();
    try {
      await adapter.set("adapter_test.greeting", "hi");
      const provenance = adapter.getProvenance("adapter_test.greeting");
      assertEquals(provenance.source, ConfigProvenanceSource.DB);
      assertEquals(provenance.value, "hi");
    } finally {
      cleanUp(dir);
    }
  },
);

Deno.test(
  "[configuring] DirectConfigAdapter.getProvenance returns source=registry for default key",
  () => {
    const { adapter, dir } = setupAdapter();
    try {
      const provenance = adapter.getProvenance("adapter_test.enabled");
      assertEquals(provenance.source, ConfigProvenanceSource.REGISTRY);
      assertEquals(provenance.value, true);
    } finally {
      cleanUp(dir);
    }
  },
);

Deno.test("[configuring] DirectConfigAdapter.getHistory returns chronological history", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    await adapter.set("adapter_test.log_level", "debug");
    await adapter.set("adapter_test.log_level", "error");
    const history = adapter.getHistory("adapter_test.log_level");
    // At least seed (NULL), debug, error
    assertEquals(history.length >= 3, true);
    // Newest first (DESC order)
    assertEquals(history[0].value, "error");
    assertEquals(history[1].value, "debug");
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] createConfigAdapter returns a working adapter", () => {
  const dir = Deno.makeTempDirSync({ prefix: "adapter-test-" });
  try {
    const dbPath = ensureConfigDb(dir);
    const db = new Database(dbPath);
    try {
      migrateConfigDb(db);
      seedConfigDb(db);
    } finally {
      db.close();
    }
    const adapter = createConfigAdapter(dbPath);
    assertNotEquals(adapter, null);
    assertEquals(adapter.get("adapter_test.greeting"), "hello");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

// --- GAP-9: ConfigUpdated audit-event emission ---

function setupAdapterWithLogger(): {
  adapter: DirectConfigAdapter;
  events: ICapturedEvent[];
  dir: string;
} {
  const dir = Deno.makeTempDirSync({ prefix: "adapter-test-" });
  const dbPath = ensureConfigDb(dir);
  const db = new Database(dbPath);
  try {
    migrateConfigDb(db);
    seedConfigDb(db);
  } finally {
    db.close();
  }
  const { logger, events } = createSpyLogger();
  const adapter = new DirectConfigAdapter(dbPath, undefined, logger);
  return { adapter, events, dir };
}

Deno.test("[configuring] DirectConfigAdapter.set emits ConfigUpdated", async () => {
  const { adapter, events, dir } = setupAdapterWithLogger();
  try {
    await adapter.set("adapter_test.timeout_ms", 60000);
    const configEvents = events.filter((e) => e.action === DomainEventType.ConfigUpdated);
    assertEquals(configEvents.length, 1);
    assertEquals(configEvents[0].target, "adapter_test.timeout_ms");
    assertEquals(configEvents[0].payload?.value, 60000);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] DirectConfigAdapter.unset emits ConfigUpdated with null value", async () => {
  const { adapter, events, dir } = setupAdapterWithLogger();
  try {
    await adapter.unset("adapter_test.greeting");
    const configEvents = events.filter((e) => e.action === DomainEventType.ConfigUpdated);
    assertEquals(configEvents.length, 1);
    assertEquals(configEvents[0].target, "adapter_test.greeting");
    assertEquals(configEvents[0].payload?.value, null);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] DirectConfigAdapter.set without logger does not throw", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    await adapter.set("adapter_test.timeout_ms", 45000);
    assertEquals(adapter.get("adapter_test.timeout_ms"), 45000);
  } finally {
    cleanUp(dir);
  }
});

// --- GAP-13: getProvenance returns coerced native-type value ---

Deno.test(
  "[configuring] DirectConfigAdapter.getProvenance returns coerced numeric value for overridden numeric key",
  async () => {
    const { adapter, dir } = setupAdapter();
    try {
      await adapter.set("adapter_test.timeout_ms", 60000);
      const provenance = adapter.getProvenance("adapter_test.timeout_ms");
      assertEquals(provenance.source, ConfigProvenanceSource.DB);
      assertEquals(provenance.value, 60000);
      assertEquals(typeof provenance.value, "number");
    } finally {
      cleanUp(dir);
    }
  },
);

// --- GAP-14: unset enforces registry existence check ---

Deno.test(
  "[configuring] DirectConfigAdapter.unset throws ConfigKeyNotFoundError for unknown key",
  async () => {
    const { adapter, dir } = setupAdapter();
    try {
      await assertRejects(
        () => adapter.unset("nonexistent.key"),
        ConfigKeyNotFoundError,
      );
    } finally {
      cleanUp(dir);
    }
  },
);

Deno.test(
  "[configuring] DirectConfigAdapter.unset succeeds for a registered key",
  async () => {
    const { adapter, dir } = setupAdapter();
    try {
      await adapter.set("adapter_test.greeting", "hey");
      await adapter.unset("adapter_test.greeting");
      assertEquals(adapter.get("adapter_test.greeting"), "hello");
    } finally {
      cleanUp(dir);
    }
  },
);

// --- Step 1 (GAP-11/GAP-12): namespaced dynamic-key validation ---

Deno.test(
  "[configuring] resolveValidationKey returns exact key for a registered key",
  () => {
    const { adapter, dir } = setupAdapter();
    try {
      assertEquals(
        adapter.resolveValidationKey("adapter_test.timeout_ms"),
        "adapter_test.timeout_ms",
      );
    } finally {
      cleanUp(dir);
    }
  },
);

Deno.test(
  "[configuring] resolveValidationKey maps profile.<name>.<base> to the base key",
  () => {
    const { adapter, dir } = setupAdapter();
    try {
      assertEquals(
        adapter.resolveValidationKey("profile.dev.adapter_test.timeout_ms"),
        "adapter_test.timeout_ms",
      );
    } finally {
      cleanUp(dir);
    }
  },
);

Deno.test(
  "[configuring] resolveValidationKey maps a per-name key to its pattern key",
  () => {
    const { adapter, dir } = setupAdapter();
    try {
      assertEquals(
        adapter.resolveValidationKey("adapter_test.models.default.model"),
        "adapter_test.models.*.model",
      );
    } finally {
      cleanUp(dir);
    }
  },
);

Deno.test(
  "[configuring] resolveValidationKey returns undefined for a genuinely unknown key",
  () => {
    const { adapter, dir } = setupAdapter();
    try {
      assertEquals(adapter.resolveValidationKey("totally.unknown.key"), undefined);
    } finally {
      cleanUp(dir);
    }
  },
);

Deno.test(
  "[configuring] set() persists a profile-scoped key and validates against its base key",
  async () => {
    const { adapter, dir } = setupAdapter();
    try {
      await adapter.set("profile.dev.adapter_test.timeout_ms", 70000);
      // Stored under the ORIGINAL profile key, not the base key.
      assertEquals(adapter.get("profile.dev.adapter_test.timeout_ms"), 70000);
      // Base key remains at its registry default (unaffected).
      assertEquals(adapter.get("adapter_test.timeout_ms"), 30000);
    } finally {
      cleanUp(dir);
    }
  },
);

Deno.test(
  "[configuring] set() rejects a profile-scoped value that violates the base key's bounds",
  async () => {
    const { adapter, dir } = setupAdapter();
    try {
      await assertRejects(
        () => adapter.set("profile.dev.adapter_test.timeout_ms", 500),
        Error, // ConfigValidationError — below adapter_test.timeout_ms min (1000)
      );
    } finally {
      cleanUp(dir);
    }
  },
);

Deno.test(
  "[configuring] set() persists a pattern-matched per-name key",
  async () => {
    const { adapter, dir } = setupAdapter();
    try {
      await adapter.set("adapter_test.models.default.model", "gemini-flash");
      assertEquals(adapter.get("adapter_test.models.default.model"), "gemini-flash");
    } finally {
      cleanUp(dir);
    }
  },
);

Deno.test(
  "[configuring] set() still throws ConfigKeyNotFoundError for a genuinely unknown key",
  async () => {
    const { adapter, dir } = setupAdapter();
    try {
      await assertRejects(
        () => adapter.set("totally.unknown.key", 1),
        ConfigKeyNotFoundError,
      );
    } finally {
      cleanUp(dir);
    }
  },
);

// ── Phase 138 Step 2: adapter blocklist delegation ──────────────────────────

Deno.test("[configuring] adapter.isPathBlocked delegates to DAO", () => {
  const { adapter, dir } = setupAdapter();
  try {
    // Not blocked initially.
    assertEquals(adapter.isPathBlocked("system.root"), false);

    // Seed a block directly via the DAO on the same config DB.
    const db = new Database(ensureConfigDb(dir));
    try {
      addBlocklistPattern(db, "system.*", "admin lock");
    } finally {
      db.close();
    }

    assertEquals(adapter.isPathBlocked("system.root"), true);
    assertEquals(adapter.getBlockReason("system.root"), "admin lock");
    assertEquals(adapter.isPathBlocked("ai.timeout_ms"), false);
    assertEquals(adapter.getBlockReason("ai.timeout_ms"), undefined);
  } finally {
    cleanUp(dir);
  }
});

// ── Phase 138 Step 3: adapter rate-limit delegation + error ─────────────────

Deno.test("[configuring] adapter.countRecentWrites delegates to DAO", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    await adapter.set("adapter_test.timeout_ms", 45000);
    await adapter.set("adapter_test.greeting", "hi");
    // Both are cli writes within the window.
    assertEquals(adapter.countRecentWrites(5000) >= 2, true);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] adapter.compact delegates to DAO and preserves values", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    await adapter.set("adapter_test.timeout_ms", 40000);
    await adapter.set("adapter_test.timeout_ms", 41000);
    await adapter.set("adapter_test.timeout_ms", 42000);
    const removed = adapter.compact();
    assertEquals(removed >= 2, true);
    assertEquals(adapter.get("adapter_test.timeout_ms"), 42000);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] ConfigRateLimitedError has correct surface and limit fields", () => {
  const err = new ConfigRateLimitedError("cli", "max 10 writes per 5s");
  assertEquals(err.name, "ConfigRateLimitedError");
  assertEquals(err.message.includes("cli"), true);
  assertEquals(err.message.includes("max 10 writes per 5s"), true);
});

// ── Phase 139 Step 3: config rollback (append restoring a historical value) ──
// Reuses the existing setupAdapterWithLogger() helper (spy logger).

Deno.test("[configuring] adapter.rollback appends a row restoring the historical value with source=rollback", async () => {
  const { adapter, dir } = setupAdapterWithLogger();
  try {
    await adapter.set("adapter_test.timeout_ms", 40000);
    await adapter.set("adapter_test.timeout_ms", 41000);
    // History is DESC by id: [41000, 40000, seed-null]. Roll back to the 40000 row.
    const history = adapter.getHistory("adapter_test.timeout_ms");
    const target = history.find((r) => r.value === "40000")!;
    const restored = await adapter.rollback("adapter_test.timeout_ms", target.id);
    assertEquals(restored, "40000", "rollback returns the restored value");
    // Effective value is now the restored one (a NEW appended row).
    assertEquals(adapter.get("adapter_test.timeout_ms"), 40000);
    // The newest history row is source=rollback.
    const newest = adapter.getHistory("adapter_test.timeout_ms")[0];
    assertEquals(newest.source, "rollback");
    assertEquals(newest.value, "40000");
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] adapter.rollback throws ConfigKeyNotFoundError for an unknown (key,id)", async () => {
  const { adapter, dir } = setupAdapterWithLogger();
  try {
    await adapter.set("adapter_test.timeout_ms", 40000);
    await assertRejects(
      () => adapter.rollback("adapter_test.timeout_ms", 999999),
      ConfigKeyNotFoundError,
    );
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] adapter.rollback emits ConfigRolledBack with to_id + restored_value", async () => {
  const { adapter, events, dir } = setupAdapterWithLogger();
  try {
    await adapter.set("adapter_test.timeout_ms", 40000);
    const target = adapter.getHistory("adapter_test.timeout_ms").find((r) => r.value === "40000")!;
    await adapter.rollback("adapter_test.timeout_ms", target.id);
    const ev = events.find((e) => e.action === DomainEventType.ConfigRolledBack);
    assertNotEquals(ev, undefined, "ConfigRolledBack must be emitted");
    assertEquals(ev!.payload?.to_id, target.id);
    assertEquals(ev!.payload?.restored_value, "40000");
  } finally {
    cleanUp(dir);
  }
});

// ── Phase 139 Step 4: key locking enforced in DirectConfigAdapter.set() ──────

Deno.test("[configuring] adapter.lock/unlock round-trip + isLocked/listLocks", () => {
  const { adapter, dir } = setupAdapter();
  try {
    assertEquals(adapter.isLocked("adapter_test.timeout_ms"), false);
    adapter.lock("adapter_test.timeout_ms", "cli", "test lock");
    assertEquals(adapter.isLocked("adapter_test.timeout_ms"), true);
    const locks = adapter.listLocks();
    assertEquals(locks.some((l) => l.key === "adapter_test.timeout_ms"), true);
    adapter.unlock("adapter_test.timeout_ms", "cli");
    assertEquals(adapter.isLocked("adapter_test.timeout_ms"), false);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] DirectConfigAdapter.set throws ConfigKeyLockedError for a locked key", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    adapter.lock("adapter_test.timeout_ms", "cli");
    await assertRejects(
      () => adapter.set("adapter_test.timeout_ms", 55000),
      ConfigKeyLockedError,
    );
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] DirectConfigAdapter.set refuses a locked key via a profile-scoped path (GAP-1)", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    adapter.lock("adapter_test.timeout_ms", "cli");
    // A profile-scoped write must be rejected because resolveValidationKey
    // resolves "profile.dev.adapter_test.timeout_ms" to the base key
    // "adapter_test.timeout_ms", and the lock is on the base key.
    await assertRejects(
      () => adapter.set("profile.dev.adapter_test.timeout_ms", 50000),
      ConfigKeyLockedError,
    );
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] DirectConfigAdapter.set succeeds after unlock", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    adapter.lock("adapter_test.timeout_ms", "cli");
    adapter.unlock("adapter_test.timeout_ms", "cli");
    await adapter.set("adapter_test.timeout_ms", 55000);
    assertEquals(adapter.get("adapter_test.timeout_ms"), 55000);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] adapter.lock/unlock emit ConfigKeyLocked/ConfigKeyUnlocked", () => {
  const { adapter, events, dir } = setupAdapterWithLogger();
  try {
    adapter.lock("adapter_test.timeout_ms", "cli", "why");
    adapter.unlock("adapter_test.timeout_ms", "cli");
    assertNotEquals(
      events.find((e) => e.action === DomainEventType.ConfigKeyLocked),
      undefined,
      "ConfigKeyLocked must be emitted",
    );
    assertNotEquals(
      events.find((e) => e.action === DomainEventType.ConfigKeyUnlocked),
      undefined,
      "ConfigKeyUnlocked must be emitted",
    );
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] adapter.unlock emits ConfigKeyUnlocked with the caller-supplied locked_by (GAP-5)", () => {
  const { adapter, events, dir } = setupAdapterWithLogger();
  try {
    adapter.lock("adapter_test.timeout_ms", "cli");
    adapter.unlock("adapter_test.timeout_ms", "test-actor");
    const ev = events.find((e) => e.action === DomainEventType.ConfigKeyUnlocked);
    assertNotEquals(ev, undefined, "ConfigKeyUnlocked must be emitted");
    assertEquals(ev!.payload?.locked_by, "test-actor");
  } finally {
    cleanUp(dir);
  }
});

// ── Phase 139 Step 5: integrity checksum ────────────────────────────────────

Deno.test("[configuring] computeIntegrityChecksum is stable across calls on unchanged config", () => {
  const { adapter, dir } = setupAdapter();
  try {
    const a = adapter.computeIntegrityChecksum();
    const b = adapter.computeIntegrityChecksum();
    assertEquals(a, b);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] computeIntegrityChecksum excludes the _checksum key itself", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    const before = adapter.computeIntegrityChecksum();
    // Persisting the checksum inserts a _checksum override; recomputing must
    // ignore it (self-exclusion) so the value is a fixed point, not unstable.
    await adapter.verifyIntegrity(); // seeds the _checksum row
    const after = adapter.computeIntegrityChecksum();
    assertEquals(after, before);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] computeIntegrityChecksum changes when an override changes", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    const before = adapter.computeIntegrityChecksum();
    await adapter.set("adapter_test.timeout_ms", 61000);
    const after = adapter.computeIntegrityChecksum();
    assertNotEquals(after, before);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] verifyIntegrity returns ok on first run and persists the checksum", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    const first = await adapter.verifyIntegrity();
    assertEquals(first.ok, true);
    // Stored checksum now present — a second verify still matches.
    const second = await adapter.verifyIntegrity();
    assertEquals(second.ok, true);
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] verifyIntegrity detects an out-of-band edit and emits ConfigIntegrityMismatch", async () => {
  const { adapter, events, dir } = setupAdapterWithLogger();
  try {
    await adapter.verifyIntegrity(); // seed
    // Write a config_overrides row directly, bypassing the adapter (and thus
    // its checksum refresh) — simulating an out-of-band DB edit.
    const dbPath = ensureConfigDb(dir);
    const raw = new Database(dbPath);
    try {
      raw.prepare(
        "INSERT INTO config_overrides (key, value, source, swap_class) VALUES (?, ?, ?, ?)",
      ).run("adapter_test.timeout_ms", "99999", "manual", "hot");
    } finally {
      raw.close();
    }
    const result = await adapter.verifyIntegrity();
    assertEquals(result.ok, false);
    assertNotEquals(
      events.find((e) => e.action === DomainEventType.ConfigIntegrityMismatch),
      undefined,
      "ConfigIntegrityMismatch must be emitted on mismatch",
    );
  } finally {
    cleanUp(dir);
  }
});

Deno.test("[configuring] listOverrides/diff exclude the _checksum synthetic key", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    await adapter.verifyIntegrity(); // seeds _checksum
    assertEquals(
      adapter.listOverrides().some((o) => o.key === CONFIG_CHECKSUM_KEY),
      false,
      "_checksum must not appear in listOverrides",
    );
    assertEquals(
      adapter.diff().overridden.some((o) => o.path === CONFIG_CHECKSUM_KEY),
      false,
      "_checksum must not appear in diff",
    );
  } finally {
    cleanUp(dir);
  }
});
