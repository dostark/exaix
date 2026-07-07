/**
 * @module ConfigAdapterTest
 * @path packages/core/tests/config/adapter_test.ts
 * @description Tests for DirectConfigAdapter and createConfigAdapter factory.
 */
import { Database } from "@db/sqlite";
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { configurable } from "../../src/config/registry.ts";
import { ConfigProvenanceSource, ConfigValueType } from "../../src/types/enums.ts";
import { ensureConfigDb, migrateConfigDb, seedConfigDb } from "../../src/config/db.ts";
import { createConfigAdapter, DirectConfigAdapter } from "../../src/config/adapter.ts";
import { ConfigKeyNotFoundError } from "../../src/config/errors.ts";
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
    warn: () => Promise.resolve(),
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
