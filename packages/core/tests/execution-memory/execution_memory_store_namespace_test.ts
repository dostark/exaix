/**
 * @module ExecutionMemoryStoreNamespaceTest
 * @path packages/core/tests/execution-memory/execution_memory_store_namespace_test.ts
 * @description Ports FlowNamespaceService's real contract onto ExecutionMemoryStore's
 * writeNamespaceEntries/readKeys: batch writes with mixed from/no-from/append modes,
 * skip-on-invalid-key, truncate-on-oversized-value, and throw-only-on-total-quota.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";

import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { IFlowNamespaceWrite } from "@exaix/schemas/flow.ts";
import { resolveMemoryExecutionRoot } from "../../src/config/mod.ts";
import { DEFAULT_NAMESPACE_MAX_BYTES } from "@exaix/core";
import { ExecutionMemoryStore, NamespaceQuotaExceededError } from "@exaix/core/execution-memory";

function makeConfig(root: string): Config {
  return ConfigSchema.parse({
    system: { root },
    paths: {},
    database: {},
    watcher: {},
    agents: {},
    models: {},
    portals: [],
    mcp: {},
  });
}

function executionDir(root: string, config: Config): string {
  return join(root, resolveMemoryExecutionRoot(config.paths));
}

Deno.test("ExecutionMemoryStore: batch namespace writes with from-path extraction, full output, and append mode", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-exec-mem-ns-" });
  try {
    const store = new ExecutionMemoryStore(makeConfig(tempDir));
    const traceId = "trace-batch";

    await store.writeNamespaceEntries(traceId, "step-1", [
      { key: "summary", from: "summary", mode: "write" },
      { key: "full", mode: "write" },
    ], JSON.stringify({ summary: "extracted-value" }));

    const writes: IFlowNamespaceWrite[] = [{ key: "summary", mode: "append" }];
    await store.writeNamespaceEntries(traceId, "step-2", writes, "appended tail");
    const second = await store.readKeys(traceId, ["summary", "full", "missing"]);
    assertEquals(second.summary, "extracted-value\nappended tail");
    assertEquals(second.full, JSON.stringify({ summary: "extracted-value" }));
    assertEquals(second.missing, undefined);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionMemoryStore: an invalid namespace key is skipped (warned, not thrown) while the rest of the batch applies", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-exec-mem-key-" });
  try {
    const store = new ExecutionMemoryStore(makeConfig(tempDir));
    const warns: string[] = [];
    const originalWarn = console.warn;
    const warnSpy = (message?: string) => {
      warns.push(String(message));
    };
    console.warn = warnSpy;
    try {
      await store.writeNamespaceEntries("trace-key", "step-1", [
        { key: "unsafe\nkey", mode: "write" },
        { key: "valid.key", mode: "write" },
      ], "value");
    } finally {
      console.warn = originalWarn;
    }
    assertEquals(warns.some((w) => w.includes("unsafe\nkey")), true, "invalid key must produce a warning");
    const entries = await store.readKeys("trace-key", ["unsafe\nkey", "valid.key"]);
    assertEquals(entries["unsafe\nkey"], undefined, "invalid key must be skipped, not thrown");
    assertEquals(entries["valid.key"], "value", "the rest of the batch must still apply");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionMemoryStore: an oversized single namespace value is truncated, not rejected", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-exec-mem-trunc-" });
  try {
    const store = new ExecutionMemoryStore(makeConfig(tempDir));
    const oversized = "v".repeat(10_000);
    await store.writeNamespaceEntries(
      "trace-trunc",
      "step-1",
      [{ key: "big", from: "value", mode: "write" }],
      JSON.stringify({ value: oversized }),
    );

    const entries = await store.readKeys("trace-trunc", ["big"]);
    assertEquals(entries["big"]?.length, 8192, "value must be capped at the per-entry byte cap (8192)");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionMemoryStore: only a total-size-over-quota namespace batch throws NamespaceQuotaExceededError, before persisting", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-exec-mem-quota-" });
  try {
    const config = makeConfig(tempDir);
    const store = new ExecutionMemoryStore(config);
    const oversizedOutput = "q".repeat(DEFAULT_NAMESPACE_MAX_BYTES + 1024);
    const writes: IFlowNamespaceWrite[] = Array.from({ length: 9 }, (_, i) => ({ key: `key-${i}`, mode: "write" }));

    await assertRejects(
      () => store.writeNamespaceEntries("trace-quota", "step-1", writes, oversizedOutput),
      NamespaceQuotaExceededError,
      "Namespace quota exceeded",
    );
    assertEquals(
      await exists(join(executionDir(tempDir, config), "trace-quota", "scratchpad.jsonl")),
      false,
      "a quota-throwing batch must never persist",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionMemoryStore: getNamespacePath resolves into the trace's execution directory (never namespace.md)", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa-exec-mem-path-" });
  try {
    const config = makeConfig(tempDir);
    const store = new ExecutionMemoryStore(config);
    const path = store.getNamespacePath("trace-path");
    assertStringIncludes(path, join(resolveMemoryExecutionRoot(config.paths), "trace-path"));
    assertEquals(path.endsWith("namespace.md"), false, "the markdown artifact must be retired");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
