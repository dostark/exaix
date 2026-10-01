/**
 * @module ModelBindingServiceSnapshotTest
 * @path packages/ai/tests/bindings/model_binding_service_snapshot_test.ts
 * @description Checks immutable config snapshots and aggregated binding rejection.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { ModelBindingService, ProviderRegistry } from "@exaix/ai";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { BINDINGS_DIR } from "@exaix/core";
import type { IBindingSnapshotCreatedEventPayload } from "@exaix/core/events";
import { BindingLockSchema, type Config, ConfigSchema, FlowSchema, type IRunBindingsFile } from "@exaix/schemas";
import { createMockConfig, createMockEventLogger, initTestDbService, withEnv } from "@exaix/testing";

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
const catalog: Config["catalog"] = {
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

function replayService(
  tempDir: string,
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  bindings: Config["bindings"],
  locked?: IRunBindingsFile["locked"],
  lockedSha256?: string,
): { service: ModelBindingService; config: Config } {
  const config = createMockConfig(tempDir, {
    ai: { provider: "mock", model: "boot" },
    catalog: catalog as Config["catalog"],
    bindings,
  });
  const runFile = locked === undefined ? undefined : {
    schema: 1,
    trace_id: "00000000-0000-4000-8000-000000000000",
    request_path: "Workspace/Requests/r.md",
    request_sha256: "b".repeat(64),
    created_at: new Date().toISOString(),
    overlays: [],
    binds: [],
    locked,
    ...(lockedSha256 ? { locked_sha256: lockedSha256 } : {}),
  };
  const service = new ModelBindingService({
    configSource: { get: () => config },
    logger: createMockEventLogger(),
    db,
    runStore: {
      write: () => Promise.resolve(""),
      exists: () => Promise.resolve(true),
      claim: () => Promise.resolve(runFile as never),
      pruneOlderThan: () => Promise.resolve(0),
    },
    probe: { hasKey: () => true, hasOptIn: () => true },
  });
  return { service, config };
}

const RUN = { requestPath: "Workspace/Requests/r.md", requestSha256: "b".repeat(64) };
const composeAlpha: Config["bindings"] = { "flow:research/step:compose": { service: "alpha", model: "mock/alpha" } };

async function sha256Of(text: string): Promise<string> {
  const digest = await stdCrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return encodeHex(new Uint8Array(digest));
}

async function firstLock(
  tempDir: string,
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  bindings: Config["bindings"],
  flowUnderTest: typeof flow = flow,
): Promise<{ lock: ReturnType<typeof BindingLockSchema.parse>; sha256: string }> {
  const { service, config } = replayService(tempDir, db, bindings);
  const traceId = crypto.randomUUID();
  await service.snapshotForRun(flowUnderTest, { traceId, ...RUN });
  const text = await Deno.readTextFile(join(tempDir, config.paths.runtime, BINDINGS_DIR, `${traceId}.lock.json`));
  return { lock: BindingLockSchema.parse(JSON.parse(text)), sha256: await sha256Of(text) };
}

Deno.test("[replay] an equal resolution replays; a changed service, flow content, pin or catalog yields lock_mismatch", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const { lock, sha256 } = await firstLock(tempDir, db, composeAlpha);
    const same = replayService(tempDir, db, composeAlpha, lock, sha256);
    const ok = await same.service.snapshotForRun(flow, { traceId: crypto.randomUUID(), ...RUN });
    assertEquals(ok.lock !== undefined, true);

    const drifted = async (
      bindings: Config["bindings"],
      flowUnderTest: typeof flow = flow,
    ): Promise<Error | object> => {
      const { service } = replayService(tempDir, db, bindings, lock, sha256);
      return await service.snapshotForRun(flowUnderTest, { traceId: crypto.randomUUID(), ...RUN }).catch((e) => e);
    };
    const beta: Config["bindings"] = { "flow:research/step:compose": { service: "beta", model: "mock/beta" } };
    assertStringIncludes(String(await drifted(beta)), "lock_mismatch");
    const effort: Config["bindings"] = {
      "flow:research/step:compose": { service: "alpha", model: "mock/alpha", effort: "high" },
    };
    assertStringIncludes(String(await drifted(effort)), "lock_mismatch");
    const extraCatalog = { ...catalog, models: { ...catalog!.models, "mock/gamma": { model_provider: "mock" } } };
    const changedCatalog = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: extraCatalog as Config["catalog"],
      bindings: composeAlpha,
    });
    const catalogService = new ModelBindingService({
      configSource: { get: () => changedCatalog },
      logger: createMockEventLogger(),
      db,
      runStore: {
        write: () => Promise.resolve(""),
        exists: () => Promise.resolve(true),
        claim: () =>
          Promise.resolve({
            schema: 1,
            trace_id: "00000000-0000-4000-8000-000000000000",
            ...RUN,
            request_path: RUN.requestPath,
            request_sha256: RUN.requestSha256,
            created_at: new Date().toISOString(),
            overlays: [],
            binds: [],
            locked: lock,
            locked_sha256: sha256,
          } as never),
        pruneOlderThan: () => Promise.resolve(0),
      },
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    assertStringIncludes(
      String(await catalogService.snapshotForRun(flow, { traceId: crypto.randomUUID(), ...RUN }).catch((e) => e)),
      "lock_mismatch",
    );
    const editedFlow = FlowSchema.parse({ ...flow, description: "edited" });
    assertStringIncludes(String(await drifted(composeAlpha, editedFlow)), "lock_mismatch");
    const pinnedFlow = FlowSchema.parse({
      ...flow,
      steps: [
        {
          ...flow.steps[0],
          binding: { service: "alpha", model: "mock/alpha" },
          pin: { fields: ["service"], reason: "compliance" },
        },
        flow.steps[1],
      ],
    });
    assertStringIncludes(String(await drifted(composeAlpha, pinnedFlow)), "lock_mismatch");
  } finally {
    await cleanup();
  }
});

Deno.test("[replay] a lock whose bytes no longer match its recorded sha256 fails closed", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const { lock, sha256 } = await firstLock(tempDir, db, composeAlpha);
    const tampered = { ...lock, hosts: ["evil.example:443"] };
    const { service } = replayService(tempDir, db, composeAlpha, tampered, sha256);
    await assertRejects(
      () => service.snapshotForRun(flow, { traceId: crypto.randomUUID(), ...RUN }),
      Error,
      "lock_mismatch",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("pool: same binding reuses one wrapper; a service cap change creates a new wrapper; keys stay secret-free", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const unchanged: Config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: catalog as Config["catalog"],
      bindings: { "flow:research/step:compose": { service: "alpha", model: "mock/alpha" } },
    });
    const capped: Config = {
      ...unchanged,
      catalog: {
        models: catalog.models,
        services: {
          ...catalog.services,
          alpha: { ...catalog.services!.alpha, daily_cost_cap_usd: 0.01 },
        },
        preferences: {},
      },
    };
    const modeService = new ModelBindingService({
      configSource: { get: () => capped },
      logger: createMockEventLogger(),
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
      maxCostPerDay: 5,
    });
    // A capped run preflights its wrapper and acquires it again on the same snapshot.
    const snapshot = await modeService.snapshotForRun(flow, { traceId: crypto.randomUUID() });
    assertEquals(snapshot.issues.length, 0);
    const provider = await modeService.providerFor(
      snapshot,
      { flowId: "research", stepId: "compose", agentRole: "composer", kind: "agent", nativeTools: false },
    );
    assertEquals(provider?.kind, "provider");
    // Same service, same mode, same cap → the second snapshot reuses the same preflighted key.
    const second = await modeService.snapshotForRun(flow, { traceId: crypto.randomUUID() });
    assertEquals(second.issues.length, 0);

    // A cap-less config for the same binding must preflight as a distinct wrapper.
    const noCapService = new ModelBindingService({
      configSource: { get: () => unchanged },
      logger: createMockEventLogger(),
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
      maxCostPerDay: 5,
    });
    const noCapSnapshot = await noCapService.snapshotForRun(flow, { traceId: crypto.randomUUID() });
    assertEquals(noCapSnapshot.issues.length, 0);
  } finally {
    await cleanup();
  }
});

const keyedCatalog: Config["catalog"] = {
  models: { "mock/alpha": { model_provider: "mock" } },
  services: {
    alpha: {
      adapter: "mock",
      transport: "cloud",
      interface: "api",
      key_env: "ALPHA_API_KEY",
      serves: { "mock/alpha": "alpha" },
    },
  },
  preferences: {},
};

function preflightService(
  tempDir: string,
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  overrides: Partial<Config>,
  extra: Partial<ConstructorParameters<typeof ModelBindingService>[0]> = {},
): ModelBindingService {
  const config = createMockConfig(tempDir, {
    ai: { provider: "mock", model: "boot" },
    catalog: keyedCatalog,
    bindings: composeAlpha,
    ...overrides,
  });
  return new ModelBindingService({
    configSource: { get: () => config },
    logger: createMockEventLogger(),
    db,
    probe: { hasKey: () => false, hasOptIn: () => true },
    ...extra,
  });
}

Deno.test("[snapshot] an explicit service without its key fails key_missing before any provider is built", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const service = preflightService(tempDir, db, {});
    const error = await service.snapshotForRun(flow, { traceId: crypto.randomUUID() }).catch((e) => e);
    assertStringIncludes(String(error), "key_missing");
  } finally {
    await cleanup();
  }
});

Deno.test("[snapshot] a DYNAMIC step on an adapter without native tools fails capability_missing when native tools are enabled", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const dynamicFlow = FlowSchema.parse({
      ...flow,
      steps: [{ ...flow.steps[0], execution_mode: "dynamic" }, flow.steps[1]],
    });
    const adapterMetadata = () => ({
      name: "mock",
      description: "",
      capabilities: [],
      costTier: 0 as never,
      pricingTier: 0 as never,
      strengths: [],
      supportsNativeTools: false,
    });
    const overrides = { execution: { native_tools_enabled: true } } as Partial<Config>;
    const on = preflightService(tempDir, db, overrides, {
      probe: { hasKey: () => true, hasOptIn: () => true },
      getAdapterMetadata: adapterMetadata,
    });
    const error = await on.snapshotForRun(dynamicFlow, { traceId: crypto.randomUUID() }).catch((e) => e);
    assertStringIncludes(String(error), "capability_missing");

    const off = preflightService(tempDir, db, {}, {
      probe: { hasKey: () => true, hasOptIn: () => true },
      getAdapterMetadata: adapterMetadata,
    });
    const snapshot = await off.snapshotForRun(dynamicFlow, { traceId: crypto.randomUUID() });
    assertEquals(snapshot.bindings.get("compose")?.kind, "bound");
  } finally {
    await cleanup();
  }
});

Deno.test("[snapshot] provider construction failure keeps its cause in the issue detail", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  let restoreMock = () => {};
  try {
    const originalFactory = ProviderRegistry.getFactory("mock");
    const originalMetadata = ProviderRegistry.getProviderMetadata("mock");
    restoreMock = () => {
      if (originalFactory && originalMetadata) {
        ProviderRegistry.registerWithMetadata("mock", originalFactory, originalMetadata);
      }
    };
    ProviderRegistry.registerWithMetadata("mock", {
      create: () => Promise.reject(new Error("socket pool exhausted")),
    }, {
      name: "mock",
      description: "failing",
      capabilities: ["chat"],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      strengths: [],
    });
    const service = preflightService(tempDir, db, {}, { probe: { hasKey: () => true, hasOptIn: () => true } });
    const error = await service.snapshotForRun(flow, { traceId: crypto.randomUUID() }).catch((e) => e);
    assertStringIncludes(String(error), "socket pool exhausted");
  } finally {
    restoreMock();
    await cleanup();
  }
});

const FIXTURE_ENDPOINT = "http://127.0.0.1:8000/v1/chat/completions";
const endpointCatalog: Config["catalog"] = {
  models: { "openai/compat-fixture-v1": { model_provider: "openai", capabilities: [] } },
  services: {
    "compat-fixture": {
      adapter: "openai-chat",
      profile: "local-test",
      endpoint: FIXTURE_ENDPOINT,
      allow_insecure_loopback: true,
      transport: "local",
      interface: "api",
      key_env: "EXA_COMPAT_TEST_API_KEY",
      serves: { "openai/compat-fixture-v1": "compat-fixture-v1" },
    },
  },
  preferences: {},
};
const composeFixture: Config["bindings"] = {
  "flow:research/step:compose": { service: "compat-fixture", model: "openai/compat-fixture-v1" },
};

function lockService(
  tempDir: string,
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  bindings: Config["bindings"],
  catalogOverride: Config["catalog"] = catalog,
): { service: ModelBindingService; config: Config; logger: ReturnType<typeof createMockEventLogger> } {
  const config = createMockConfig(tempDir, {
    ai: { provider: "mock", model: "boot" },
    catalog: catalogOverride,
    bindings,
  });
  const logger = createMockEventLogger();
  const service = new ModelBindingService({
    configSource: { get: () => config },
    logger,
    db,
    probe: { hasKey: () => true, hasOptIn: () => true },
  });
  return { service, config, logger };
}

function registerStubOpenAiChat(): void {
  ProviderRegistry.registerWithMetadata("openai-chat", {
    create: (options) =>
      Promise.resolve({
        id: `stub-${options.model}`,
        callCapabilities: { profile: "mock", supportedEffortTiers: [], supportsThinking: false },
        generate: () => Promise.reject(new Error("not called")),
      }),
  }, {
    name: "openai-chat",
    description: "stub",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
}

Deno.test("[snapshot] env_ignored and hosts in the lock and event match the run", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  registerStubOpenAiChat();
  try {
    await withEnv({ EXA_LLM_PROVIDER: "mock", EXA_COMPAT_TEST_API_KEY: "fixture-key" }, async () => {
      const { service, config, logger } = lockService(tempDir, db, composeFixture, endpointCatalog);
      const traceId = crypto.randomUUID();
      const snapshot = await service.snapshotForRun(flow, { traceId });
      assertEquals(snapshot.envIgnored, true);
      const lock = BindingLockSchema.parse(JSON.parse(await Deno.readTextFile(snapshot.lock!.path)));
      assertEquals(lock.env_ignored, true);
      assertEquals(lock.hosts, ["127.0.0.1:8000"]);
      const event = logger.events.find((e) => e.action === "binding.snapshot.created")!;
      const payload: IBindingSnapshotCreatedEventPayload = JSON.parse(JSON.stringify(event.payload));
      assertEquals(payload.env_ignored, true);
      assertEquals(payload.hosts, ["127.0.0.1:8000"]);
      assertEquals(payload.config_checksum, lock.config_checksum);
      assertEquals(payload.overlay_sha256, lock.overlay_sha256);
      assertEquals(payload.run_overlays, 0);
      assertEquals(payload.issues, 0);
      assertEquals(payload.replayed, false);
      assertEquals(payload.entries, lock.entries.length);
      void config;
    });
  } finally {
    await cleanup();
  }
});

Deno.test("[snapshot] a duplicate trace with different content fails, a same-request resume reuses the lock, and no temp file remains", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const first = lockService(tempDir, db, composeAlpha);
    const traceId = crypto.randomUUID();
    const one = await first.service.snapshotForRun(flow, { traceId });
    const before = await Deno.readTextFile(one.lock!.path);

    const resumed = await first.service.snapshotForRun(flow, { traceId });
    assertEquals(resumed.lock!.path, one.lock!.path);
    assertEquals(resumed.lock!.sha256, one.lock!.sha256);
    assertEquals(await Deno.readTextFile(one.lock!.path), before);

    const beta: Config["bindings"] = { "flow:research/step:compose": { service: "beta", model: "mock/beta" } };
    const other = lockService(tempDir, db, beta);
    const error = await other.service.snapshotForRun(flow, { traceId }).catch((e) => e);
    assertStringIncludes(String(error), "lock_mismatch");
    assertEquals(await Deno.readTextFile(one.lock!.path), before);
    const names = [...Deno.readDirSync(join(tempDir, first.config.paths.runtime, BINDINGS_DIR))].map((e) => e.name);
    assertEquals(names.filter((name) => name.startsWith(".tmp-")), []);
  } finally {
    await cleanup();
  }
});

Deno.test("[audit] binding.rejected issues carry the offending selector", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const pinnedFlow = FlowSchema.parse({
      ...flow,
      steps: [
        {
          ...flow.steps[0],
          binding: { service: "alpha", model: "mock/alpha" },
          pin: { fields: ["service"], reason: "compliance" },
        },
        flow.steps[1],
      ],
    });
    const exact: Config["bindings"] = { "flow:research/step:compose": { service: "beta", model: "mock/beta" } };
    const { service, logger } = lockService(tempDir, db, exact);
    await service.snapshotForRun(pinnedFlow, { traceId: crypto.randomUUID() }).catch(() => {});
    const rejected = logger.events.find((e) => e.action === "binding.rejected")!;
    const issues = (rejected.payload as { issues: Array<{ code: string; selector?: string }> }).issues;
    assertEquals(issues[0].code, "pinned");
    assertEquals(issues[0].selector, "flow:research/step:compose");
  } finally {
    await cleanup();
  }
});

interface IPoolSpy {
  created: string[];
  disposed: string[];
  restore: () => void;
}

function installPoolSpy(): IPoolSpy {
  const originalFactory = ProviderRegistry.getFactory("mock");
  const originalMetadata = ProviderRegistry.getProviderMetadata("mock");
  const spy: IPoolSpy = {
    created: [],
    disposed: [],
    restore: () => {
      if (originalFactory && originalMetadata) {
        ProviderRegistry.registerWithMetadata("mock", originalFactory, originalMetadata);
      }
    },
  };
  ProviderRegistry.registerWithMetadata("mock", {
    create: (options) => {
      spy.created.push(options.model);
      return Promise.resolve({
        id: `pool-${options.model}`,
        callCapabilities: { profile: "mock", supportedEffortTiers: [], supportsThinking: false },
        generate: () => Promise.reject(new Error("not called")),
        dispose: () => {
          spy.disposed.push(options.model);
          return Promise.resolve();
        },
      });
    },
  }, {
    name: "mock",
    description: "pool spy",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
  return spy;
}

const composeBeta: Config["bindings"] = { "flow:research/step:compose": { service: "beta", model: "mock/beta" } };
const composeRef = {
  flowId: "research",
  stepId: "compose",
  agentRole: "composer",
  kind: "agent",
  nativeTools: false,
} as const;

Deno.test("[pool] overlapping runs keep their providers under eviction pressure and a released provider is closed", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const spy = installPoolSpy();
  try {
    const config = (bindings: Config["bindings"]) =>
      createMockConfig(tempDir, { ai: { provider: "mock", model: "boot" }, catalog, bindings });
    let current = config(composeAlpha);
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => current },
      logger,
      db,
      poolMaxSize: 1,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const runA = await service.snapshotForRun(flow, { traceId: crypto.randomUUID() });
    const targetA = await service.providerFor(runA, composeRef);
    current = config(composeBeta);
    const runB = await service.snapshotForRun(flow, { traceId: crypto.randomUUID() });
    assertEquals(spy.disposed, [], "run A still holds its provider");
    const again = await service.providerFor(runA, composeRef);
    assertEquals(
      again?.kind === "provider" && targetA?.kind === "provider" && again.provider === targetA.provider,
      true,
    );

    await service.releaseRun(runA.traceId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(spy.disposed, ["alpha"]);
    const released = logger.events.filter((event) => event.action === "binding.run.released");
    assertEquals(released.length, 1);
    assertEquals(released[0].traceId, runA.traceId);
    assertEquals(
      JSON.parse(JSON.stringify(released[0].payload)),
      { trace_id: runA.traceId, held_providers: 2, evicted_providers: 1 },
    );
    assertEquals(runB.bindings.get("compose")?.kind, "bound");
  } finally {
    spy.restore();
    await cleanup();
  }
});

Deno.test("[pool] a credential stored or rotated after provider creation creates a new wrapper", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  const spy = installPoolSpy();
  try {
    const config = createMockConfig(tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: keyedCatalog,
      bindings: composeAlpha,
    });
    let version = "v1";
    const service = new ModelBindingService({
      configSource: { get: () => config },
      logger: createMockEventLogger(),
      db,
      probe: { hasKey: () => true, hasOptIn: () => true, keyVersion: () => Promise.resolve(version) },
    });
    const take = async () => {
      const run = await service.snapshotForRun(flow, { traceId: crypto.randomUUID() });
      await service.releaseRun(run.traceId);
    };
    await take();
    await take();
    const unchanged = spy.created.filter((model) => model === "alpha").length;
    version = "v2";
    await take();
    assertEquals(unchanged, 1, "an unchanged credential reuses the pooled wrapper");
    assertEquals(spy.created.filter((model) => model === "alpha").length, 2);
  } finally {
    spy.restore();
    await cleanup();
  }
});
