/**
 * @module FlowNamespaceCoordinatorTest
 * @path packages/flow/tests/flow_namespace_coordinator_test.ts
 * @description Direct unit coverage for FlowNamespaceCoordinator: namespace ID
 * derivation, lazy initialization, shared-namespace read attachment onto step
 * requests, and deferred write persistence after a wave settles. Extracted
 * from FlowRunner (god-object decomposition of packages/flow/src/flow_runner.ts).
 * @related-files [packages/flow/src/flow_namespace_coordinator.ts, packages/flow/src/flow_runner.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { FlowNamespaceCoordinator, type IFlowEventLogger } from "@exaix/flow";
import type { IExecutionMemoryStore } from "@exaix/core/execution-memory";
import type { IFlow, IFlowNamespaceWrite, IFlowStep, IFlowStepInput } from "@exaix/schemas/flow.ts";
import type { IFlowStepRequest } from "@exaix/flow";
import type { JSONValue } from "@exaix/core";
import type { IToolResult } from "@exaix/core/types";
import { DEFAULT_FLOW_VERSION, FlowInputSource, FlowOutputFormat } from "@exaix/core";
import { FlowSchema } from "@exaix/schemas/flow.ts";

class FakeExecutionMemoryStore implements IExecutionMemoryStore {
  initializeCalls: string[] = [];
  writeCalls: Array<{ traceId: string; stepId: string }> = [];
  store = new Map<string, Record<string, string>>();

  getNamespacePath(traceId: string): string {
    return `/tmp/${traceId}.json`;
  }

  async initialize(traceId: string): Promise<void> {
    this.initializeCalls.push(traceId);
    if (!this.store.has(traceId)) this.store.set(traceId, {});
    await this.readKeys(traceId, []);
  }

  appendNote(_traceId: string, _content: string, _tags?: string[]): Promise<IToolResult> {
    return Promise.resolve({ success: true, data: {} });
  }

  readNotes(_traceId: string): Promise<never[]> {
    return Promise.resolve([]);
  }

  readKeys(traceId: string, keys: string[]): Promise<Record<string, string | undefined>> {
    // Initialize == first-touch hydration (empty-key read); keeps the pre-migration assertion meaning.
    if (keys.length === 0) {
      this.initializeCalls.push(traceId);
    }
    const entries = this.store.get(traceId) ?? {};
    const result: Record<string, string | undefined> = {};
    for (const key of keys) {
      result[key] = entries[key];
    }
    return Promise.resolve(result);
  }

  writeNamespaceEntries(
    traceId: string,
    stepId: string,
    writes: IFlowNamespaceWrite[],
    stepOutput: string,
  ): Promise<void> {
    this.writeCalls.push({ traceId, stepId });
    const entries = this.store.get(traceId) ?? {};
    for (const write of writes) {
      entries[write.key] = stepOutput;
    }
    this.store.set(traceId, entries);
    return Promise.resolve();
  }
}

class MockEventLogger implements IFlowEventLogger {
  events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>) {
    this.events.push({ event, payload });
  }
}

function buildFlow(namespaceEnabled: boolean): IFlow {
  return FlowSchema.parse({
    id: "flow-1",
    name: "Test Flow",
    description: "Test flow for namespace coordinator",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step-1",
        name: "Step 1",
        agent_role: "agent1",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: 1000 },
      },
    ],
    output: { from: ["step-1"], format: FlowOutputFormat.CONCAT },
    settings: { maxParallelism: 3, failFast: true },
    namespace: { enabled: namespaceEnabled },
  });
}

function buildStep(overrides: Partial<IFlowStepInput> = {}): IFlowStep {
  return FlowSchema.parse({
    id: "flow-1",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step-1",
        name: "Step 1",
        agent_role: "agent1",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: 1000 },
        ...overrides,
      },
    ],
    output: { from: ["step-1"], format: FlowOutputFormat.CONCAT },
    settings: { maxParallelism: 3, failFast: true },
  }).steps[0];
}

function makeStepRequest(): IFlowStepRequest {
  return { userPrompt: "do it", context: {} };
}

function makeCoordinator() {
  const eventLogger = new MockEventLogger();
  const namespaceService = new FakeExecutionMemoryStore();
  const coordinator = new FlowNamespaceCoordinator({ namespaceService, eventLogger });
  return { coordinator, eventLogger, namespaceService };
}

Deno.test("[FlowNamespaceCoordinator.getNamespaceId] prefers traceId, falls back to flowRunId", () => {
  const { coordinator } = makeCoordinator();
  assertEquals(coordinator.getNamespaceId({ traceId: "trace-1" }, "run-1"), "trace-1");
  assertEquals(coordinator.getNamespaceId({}, "run-1"), "run-1");
});

Deno.test("[FlowNamespaceCoordinator.initializeNamespace] initializes and logs when namespace enabled", async () => {
  const { coordinator, eventLogger, namespaceService } = makeCoordinator();
  const flow = buildFlow(true);

  await coordinator.initializeNamespace("ns-1", flow);

  assertEquals(namespaceService.initializeCalls, ["ns-1"]);
  assertEquals(eventLogger.events.some((e) => e.event.includes("namespace") && e.event.includes("init")), true);
});

Deno.test("[FlowNamespaceCoordinator.initializeNamespace] no-ops when namespace not enabled", async () => {
  const { coordinator, eventLogger, namespaceService } = makeCoordinator();
  const flow = buildFlow(false);

  await coordinator.initializeNamespace("ns-2", flow);

  assertEquals(namespaceService.initializeCalls, []);
  assertEquals(eventLogger.events.length, 0);
});

Deno.test("[FlowNamespaceCoordinator.attachSharedNamespace] attaches resolved reads onto the step request", async () => {
  const { coordinator, namespaceService } = makeCoordinator();
  const flow = buildFlow(true);
  await namespaceService.initialize("run-3");
  await namespaceService.writeNamespaceEntries("run-3", "step-0", [{ key: "greeting", mode: "write" }], "hello");

  const step = buildStep({ namespace: { reads: [{ key: "greeting" }] } });
  const stepRequest = makeStepRequest();

  const result = await coordinator.attachSharedNamespace(
    stepRequest,
    "run-3",
    step,
    flow,
    { userPrompt: "do it", traceId: "run-3" },
  );

  assertEquals(result.sharedNamespace?.greeting, "hello");
});

Deno.test("[FlowNamespaceCoordinator.attachSharedNamespace] throws when a required read key is missing", async () => {
  const { coordinator, namespaceService } = makeCoordinator();
  const flow = buildFlow(true);
  await namespaceService.initialize("run-4");

  const step = buildStep({ namespace: { reads: [{ key: "missing-key", required: true }] } });

  await assertRejects(
    () =>
      coordinator.attachSharedNamespace(
        makeStepRequest(),
        "run-4",
        step,
        flow,
        { userPrompt: "do it", traceId: "run-4" },
      ),
    Error,
    "missing required namespace keys",
  );
});

Deno.test("[FlowNamespaceCoordinator.attachSharedNamespace] passes through unchanged when namespace disabled", async () => {
  const { coordinator } = makeCoordinator();
  const flow = buildFlow(false);
  const step = buildStep({ namespace: { reads: [{ key: "greeting" }] } });
  const stepRequest = makeStepRequest();

  const result = await coordinator.attachSharedNamespace(
    stepRequest,
    "run-5",
    step,
    flow,
    { userPrompt: "do it", traceId: "run-5" },
  );

  assertEquals(result.sharedNamespace, undefined);
});

Deno.test("[FlowNamespaceCoordinator.persistWaveNamespaceWrites] writes entries and logs when enabled", async () => {
  const { coordinator, eventLogger, namespaceService } = makeCoordinator();
  await namespaceService.initialize("run-6");

  await coordinator.persistWaveNamespaceWrites(
    {
      stepId: "step-1",
      success: true,
      duration: 5,
      startedAt: new Date(),
      completedAt: new Date(),
      namespaceWrites: { writes: [{ key: "output", mode: "write" }], stepOutput: "done" },
    },
    { traceId: "run-6", requestId: "req-6" },
    "step-1",
    "run-6",
    true,
  );

  assertEquals(namespaceService.writeCalls, [{ traceId: "run-6", stepId: "step-1" }]);
  assertEquals(eventLogger.events.some((e) => e.event.includes("namespace") && e.event.includes("write")), true);
});

Deno.test("[FlowNamespaceCoordinator.persistWaveNamespaceWrites] no-ops when namespace disabled for the run", async () => {
  const { coordinator, eventLogger, namespaceService } = makeCoordinator();

  await coordinator.persistWaveNamespaceWrites(
    {
      stepId: "step-1",
      success: true,
      duration: 5,
      startedAt: new Date(),
      completedAt: new Date(),
      namespaceWrites: { writes: [{ key: "output", mode: "write" }], stepOutput: "done" },
    },
    { traceId: "run-7", requestId: "req-7" },
    "step-1",
    "run-7",
    false,
  );

  assertEquals(namespaceService.writeCalls, []);
  assertEquals(eventLogger.events.length, 0);
});
