/**
 * @module FlowStepBindingsRunLayersTest
 * @path tests/integration/flow_step_bindings_run_layers_test.ts
 * @description Step 11: a run whose only binding source is its operator run file still
 *   binds, and a drifted `--locked` lock fails the run before any provider call.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { RunBindingsStore } from "@exaix/ai";
import { FlowOutputFormat, type IDatabaseService } from "@exaix/core";
import { ConfigSchema, FlowSchema, type IRunBindingsFile } from "@exaix/schemas";
import { initTestDbService } from "@exaix/testing";
import { alphaBetaConfig, createBindingHarness } from "./helpers/flow_binding_harness.ts";

const flow = FlowSchema.parse({
  id: "research",
  name: "Research",
  description: "Run layer flow",
  steps: [
    { id: "compose", name: "Compose", agent_role: "composer" },
    { id: "explore", name: "Explore", agent_role: "explorer", dependsOn: ["compose"] },
  ],
  output: { from: "explore", format: FlowOutputFormat.MARKDOWN },
});

const REQUEST_PATH = "Workspace/Requests/request-run-layer.md";
const REQUEST_SHA = "a".repeat(64);

async function harness(tempDir: string, db: IDatabaseService, nativeTools = false, poolMaxSize?: number) {
  const config = ConfigSchema.parse({
    ...alphaBetaConfig(tempDir),
    execution: { native_tools_enabled: nativeTools },
  });
  const built = await createBindingHarness({
    tempDir,
    db,
    configSource: { get: () => config },
    runStore: new RunBindingsStore(config),
    ...(poolMaxSize !== undefined ? { poolMaxSize } : {}),
  });
  return { ...built, config };
}

function runFile(traceId: string, extra: Partial<IRunBindingsFile>): IRunBindingsFile {
  return {
    schema: 1,
    trace_id: traceId,
    request_path: REQUEST_PATH,
    request_sha256: REQUEST_SHA,
    created_at: new Date().toISOString(),
    overlays: [],
    binds: [],
    ...extra,
  };
}

Deno.test("[runtime] --bind alone on a daemon with no config bindings and no overlay directory moves the step and writes a lock", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const { factory, logger, config, runner } = await harness(tempDir, db);
    const traceId = crypto.randomUUID();
    await new RunBindingsStore(config).write(runFile(traceId, {
      binds: [{ selector: "default", spec: { service: "beta", model: "mock/beta" } }],
    }));
    const result = await runner.execute(flow, {
      userPrompt: "Research",
      traceId,
      requestPath: REQUEST_PATH,
      requestSha256: REQUEST_SHA,
    });
    assertEquals(result.success, true);
    assertEquals(factory.calls, ["beta", "beta"]);
    const resolved = logger.events.filter((event) => event.action === "binding.resolved");
    assertEquals(resolved.length, 2);
    assertEquals(
      (resolved[0].payload as { sources: { service: { layer: string } } }).sources.service.layer,
      "cli",
    );
    const lock = join(tempDir, config.paths.runtime, "bindings", `${traceId}.lock.json`);
    assertEquals((await Deno.stat(lock)).isFile, true);
  } finally {
    await cleanup();
  }
});

Deno.test("[replay] a drifted --locked lock fails the run before any provider call", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const { factory, logger, config, runner } = await harness(tempDir, db);
    const first = crypto.randomUUID();
    const store = new RunBindingsStore(config);
    await store.write(runFile(first, {
      binds: [{ selector: "default", spec: { service: "alpha", model: "mock/alpha" } }],
    }));
    await runner.execute(flow, {
      userPrompt: "a",
      traceId: first,
      requestPath: REQUEST_PATH,
      requestSha256: REQUEST_SHA,
    });
    const lockPath = join(tempDir, config.paths.runtime, "bindings", `${first}.lock.json`);
    const lockText = await Deno.readTextFile(lockPath);

    const replay = crypto.randomUUID();
    await store.write(runFile(replay, {
      binds: [{ selector: "default", spec: { service: "beta", model: "mock/beta" } }],
      locked: JSON.parse(lockText),
    }));
    factory.calls.length = 0;
    const result = await runner.execute(flow, {
      userPrompt: "b",
      traceId: replay,
      requestPath: REQUEST_PATH,
      requestSha256: REQUEST_SHA,
    });
    assertEquals(result.success, false);
    assertEquals(factory.calls, []);
    const rejected = logger.events.filter((event) => event.action === "binding.rejected");
    assertEquals(rejected.length, 1);
    assertStringIncludes(JSON.stringify(rejected[0].payload), "lock_mismatch");
  } finally {
    await cleanup();
  }
});

Deno.test("[validation] a DYNAMIC step bound to an adapter without native tools fails capability_missing before any provider call", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const { factory, logger, config, runner } = await harness(tempDir, db, true);
    const traceId = crypto.randomUUID();
    await new RunBindingsStore(config).write(runFile(traceId, {
      binds: [{ selector: "default", spec: { service: "alpha", model: "mock/alpha" } }],
    }));
    const dynamicFlow = FlowSchema.parse({
      ...flow,
      steps: [{ ...flow.steps[0], execution_mode: "dynamic" }, flow.steps[1]],
    });
    const result = await runner.execute(dynamicFlow, {
      userPrompt: "Research",
      traceId,
      requestPath: REQUEST_PATH,
      requestSha256: REQUEST_SHA,
    });
    assertEquals(result.success, false);
    assertEquals(factory.calls, []);
    const rejected = logger.events.filter((event) => event.action === "binding.rejected");
    assertEquals(rejected.length, 1);
    assertStringIncludes(JSON.stringify(rejected[0].payload), "capability_missing");
  } finally {
    await cleanup();
  }
});

Deno.test("[pool] a finished run releases its holds so an over-capacity provider is closed", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const { factory, config, runner } = await harness(tempDir, db, false, 1);
    const traceId = crypto.randomUUID();
    await new RunBindingsStore(config).write(runFile(traceId, {
      binds: [
        { selector: "flow:research/step:compose", spec: { service: "alpha", model: "mock/alpha" } },
        { selector: "flow:research/step:explore", spec: { service: "beta", model: "mock/beta" } },
      ],
    }));
    const result = await runner.execute(flow, {
      userPrompt: "Research",
      traceId,
      requestPath: REQUEST_PATH,
      requestSha256: REQUEST_SHA,
    });
    assertEquals(result.success, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(factory.disposed.length, 1, "two providers were held; the run's end frees one over the cap of 1");
  } finally {
    await cleanup();
  }
});
