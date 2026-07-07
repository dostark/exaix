/**
 * @module ConfigAdapterTest
 * @path packages/core/tests/config/adapter_test.ts
 * @description Tests for DirectConfigAdapter and createConfigAdapter factory.
 */
import { Database } from "@db/sqlite";
import { assertEquals, assertNotEquals } from "@std/assert";
import { configurable } from "../../src/config/registry.ts";
import { ConfigProvenanceSource, ConfigValueType } from "../../src/types/enums.ts";
import { ensureConfigDb, migrateConfigDb, seedConfigDb } from "../../src/config/db.ts";
import { createConfigAdapter, DirectConfigAdapter } from "../../src/config/adapter.ts";

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
