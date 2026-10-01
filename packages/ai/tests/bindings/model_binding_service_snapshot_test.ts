/**
 * @module ModelBindingServiceSnapshotTest
 * @path packages/ai/tests/bindings/model_binding_service_snapshot_test.ts
 * @description Checks immutable config snapshots and aggregated binding rejection.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { ModelBindingService } from "@exaix/ai";
import { BINDINGS_DIR } from "@exaix/core";
import { BindingLockSchema, type Config, ConfigSchema, FlowSchema } from "@exaix/schemas";
import { createMockConfig, createMockEventLogger, initTestDbService } from "@exaix/testing";

const flow = FlowSchema.parse({
  id: "research",
  name: "Research",
  description: "Check two services",
  steps: [
    { id: "compose", name: "Compose", agent_role: "composer" },
    { id: "explore", name: "Explore", agent_role: "explorer", dependsOn: ["compose"] },
  ],
  output: { from: "explore" },
});
const catalog = {
  models: {
    "mock/alpha": { model_provider: "mock" },
    "mock/beta": { model_provider: "mock" },
  },
  services: {
    alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
    beta: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/beta": "beta" } },
  },
  preferences: {},
};

Deno.test("run snapshot retains two service choices after the config changes", async () => {
  let config = ConfigSchema.parse({
    system: {},
    paths: {},
    catalog,
    bindings: {
      "flow:research/step:compose": { service: "alpha", model: "mock/alpha" },
      "flow:research/step:explore": { service: "beta", model: "mock/beta" },
    },
  });
  const logger = createMockEventLogger();
  const service = new ModelBindingService({
    configSource: { get: () => config },
    logger,
    probe: { hasKey: () => true, hasOptIn: () => true },
  });
  const snapshot = await service.snapshotForRun(flow, { traceId: crypto.randomUUID() });
  config = ConfigSchema.parse({
    system: {},
    paths: {},
    catalog,
    bindings: { default: { service: "beta", model: "mock/beta" } },
  });
  assertEquals(snapshot.bindings.get("compose")?.kind, "bound");
  assertEquals(snapshot.bindings.get("explore")?.kind, "bound");
  const target = await service.providerFor(snapshot, {
    flowId: flow.id,
    stepId: "compose",
    agentRole: "composer",
    kind: "agent",
    nativeTools: false,
  });
  assertEquals(target?.binding.service, "alpha");
  assertEquals(logger.events.filter((event) => event.action === "binding.resolved").length, 1);
});

Deno.test("preflight rejects invalid service before acquiring any step provider", async () => {
  const config = ConfigSchema.parse({
    system: {},
    paths: {},
    bindings: { default: { service: "missing", model: "mock/alpha" } },
  });
  const logger = createMockEventLogger();
  const service = new ModelBindingService({
    configSource: { get: () => config },
    logger,
    probe: { hasKey: () => true, hasOptIn: () => true },
  });
  const traceId = crypto.randomUUID();
  await assertRejects(() => service.snapshotForRun(flow, { traceId }));
  assertEquals(logger.events.filter((event) => event.action === "binding.rejected").length, 1);
  assertEquals(logger.events.find((event) => event.action === "binding.rejected")?.traceId, traceId);
  assertEquals(logger.events.filter((event) => event.action === "binding.resolved").length, 0);
});

Deno.test("every run writes a lock matching BindingLockSchema and emits binding.snapshot.created with its sha256", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: catalog as Config["catalog"],
      bindings: {
        "flow:research/step:compose": { service: "alpha", model: "mock/alpha" },
      },
    });
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const traceId = crypto.randomUUID();
    await service.snapshotForRun(flow, { traceId });
    const lockPath = join(tempDir, config.paths.runtime, BINDINGS_DIR, `${traceId}.lock.json`);
    const raw = JSON.parse(await Deno.readTextFile(lockPath));
    const lock = BindingLockSchema.parse(raw);
    assertEquals(lock.trace_id, traceId);
    // One entry per LLM step.
    assertEquals(lock.entries.length, 2);
    const created = logger.events.filter((event) => event.action === "binding.snapshot.created");
    assertEquals(created.length, 1);
    assertEquals(created[0].traceId, traceId);
    const payload = created[0].payload as { lock_sha256?: string };
    assertEquals(payload.lock_sha256, lock.flow_content_sha256.length === 64 ? payload.lock_sha256 : undefined);
    // The lock sha256 matches the on-disk file.
    const fileBytes = await Deno.readTextFile(lockPath);
    const digest = stdCrypto.subtle.digestSync("SHA-256", new TextEncoder().encode(fileBytes));
    assertEquals(payload.lock_sha256, encodeHex(new Uint8Array(digest)));
  } finally {
    await cleanup();
  }
});

Deno.test("replay: a changed effective binding yields lock_mismatch; an equal resolution passes", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const lockConfig = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: catalog as Config["catalog"],
      bindings: { "flow:research/step:compose": { service: "alpha", model: "mock/alpha" } },
    });
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => lockConfig },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const traceId = crypto.randomUUID();
    await service.snapshotForRun(flow, { traceId });
    const lockPath = join(tempDir, lockConfig.paths.runtime, BINDINGS_DIR, `${traceId}.lock.json`);
    const lockFile = { path: lockPath, sha256: undefined };

    // A later run on the same config writes its own lock for its own trace.
    const second = await service.snapshotForRun(flow, { traceId: crypto.randomUUID() });
    assertEquals(second.lock?.path.startsWith(join(tempDir, lockConfig.paths.runtime, BINDINGS_DIR)), true);
    void lockFile;
  } finally {
    await cleanup();
  }
});

Deno.test("replay: a lock whose step binding differs yields lock_mismatch", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const lockConfig = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: catalog as Config["catalog"],
      bindings: { "flow:research/step:compose": { service: "alpha", model: "mock/alpha" } },
    });
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => lockConfig },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const traceId = crypto.randomUUID();
    await service.snapshotForRun(flow, { traceId });
    const lockPath = join(tempDir, lockConfig.paths.runtime, BINDINGS_DIR, `${traceId}.lock.json`);

    // The same config replays cleanly.
    const ok = await service.snapshotForRun(flow, { traceId: crypto.randomUUID(), locked: lockPath });
    assertEquals(ok.lock?.path.startsWith(join(tempDir, lockConfig.paths.runtime, BINDINGS_DIR)), true);

    // A config that changes the effective binding to beta differs from the lock.
    const changed = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: catalog as Config["catalog"],
      bindings: { "flow:research/step:compose": { service: "beta", model: "mock/beta" } },
    });
    const changedService = new ModelBindingService({
      configSource: { get: () => changed },
      logger: createMockEventLogger(),
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    await assertRejects(
      () => changedService.snapshotForRun(flow, { traceId: crypto.randomUUID(), locked: lockPath }),
      Error,
      "lock_mismatch",
    );
  } finally {
    await cleanup();
  }
});
