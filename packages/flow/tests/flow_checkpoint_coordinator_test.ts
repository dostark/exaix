/**
 * @module FlowCheckpointCoordinatorTest
 * @path packages/flow/tests/flow_checkpoint_coordinator_test.ts
 * @description Direct unit coverage for FlowCheckpointCoordinator: checkpoint
 * load/restore/migrate, snapshot build, save, and clear-on-success. Extracted
 * from FlowRunner (god-object decomposition of packages/flow/src/flow_runner.ts).
 * @related-files [packages/flow/src/flow_checkpoint_coordinator.ts, packages/flow/src/flow_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { FlowCheckpointCoordinator, type IFlowEventLogger } from "@exaix/flow";
import { FlowSchema, type IFlowCheckpoint, type IFlowStepResultSnapshot } from "@exaix/schemas/flow.ts";
import type { IFlow } from "@exaix/schemas/flow.ts";
import type { IStepResult } from "@exaix/flow";
import type { IStepDurabilityStore, IStepExecutionRecord } from "@exaix/flow";
import { DEFAULT_FLOW_VERSION, FLOW_CHECKPOINT_SCHEMA_VERSION, FlowInputSource, FlowOutputFormat } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import type { IFlowCheckpointService } from "@exaix/flow";

class FakeCheckpointService implements IFlowCheckpointService {
  store = new Map<string, IFlowCheckpoint>();
  deleteCalls: string[] = [];

  getCheckpointPath(traceId: string): string {
    return `/tmp/${traceId}.json`;
  }

  save(
    traceId: string,
    flowContentHash: string,
    completedSteps: Record<string, IFlowStepResultSnapshot>,
  ): Promise<IFlowCheckpoint> {
    const checkpoint: IFlowCheckpoint = {
      schemaVersion: FLOW_CHECKPOINT_SCHEMA_VERSION,
      traceId,
      flowContentHash,
      completedSteps,
      savedAt: new Date().toISOString(),
    };
    this.store.set(traceId, checkpoint);
    return Promise.resolve(checkpoint);
  }

  load(traceId: string): Promise<IFlowCheckpoint | null> {
    return Promise.resolve(this.store.get(traceId) ?? null);
  }

  delete(traceId: string): Promise<void> {
    this.deleteCalls.push(traceId);
    this.store.delete(traceId);
    return Promise.resolve();
  }
}

class TrackingDurabilityStore implements IStepDurabilityStore {
  saveCalls: IStepExecutionRecord[] = [];
  invalidateCalls: Array<{ recordId: string; reason: string }> = [];

  save(record: IStepExecutionRecord): Promise<void> {
    this.saveCalls.push(record);
    return Promise.resolve();
  }

  findReplayCandidate(): Promise<IStepExecutionRecord | null> {
    return Promise.resolve(null);
  }

  invalidate(recordId: string, reason: string): Promise<void> {
    this.invalidateCalls.push({ recordId, reason });
    return Promise.resolve();
  }
}

class MockEventLogger implements IFlowEventLogger {
  events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>) {
    this.events.push({ event, payload });
  }
}

function buildFlow(): IFlow {
  return FlowSchema.parse({
    id: "flow-1",
    name: "Test Flow",
    description: "Test flow for checkpoint coordinator",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step-1",
        name: "Step 1",
        identity: "agent1",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: 1000 },
      },
    ],
    output: { from: ["step-1"], format: FlowOutputFormat.CONCAT },
    settings: { maxParallelism: 3, failFast: true },
  });
}

function buildStepResults(): Map<string, IStepResult> {
  const results = new Map<string, IStepResult>();
  results.set("step-1", {
    stepId: "step-1",
    success: true,
    duration: 10,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: new Date("2026-01-01T00:00:01.000Z"),
  });
  return results;
}

function makeCoordinator(overrides: { checkpointService?: IFlowCheckpointService } = {}) {
  const eventLogger = new MockEventLogger();
  const stepDurabilityStore = new TrackingDurabilityStore();
  const checkpointService = overrides.checkpointService ?? new FakeCheckpointService();
  const coordinator = new FlowCheckpointCoordinator({
    checkpointService,
    stepDurabilityStore,
    eventLogger,
  });
  return { coordinator, eventLogger, stepDurabilityStore, checkpointService };
}

Deno.test("[FlowCheckpointCoordinator] saveCheckpointIfEnabled persists snapshot and logs saved event", async () => {
  const { coordinator, eventLogger, checkpointService } = makeCoordinator();
  const flow = buildFlow();
  const stepResults = buildStepResults();

  await coordinator.saveCheckpointIfEnabled(
    flow,
    { userPrompt: "do it", traceId: "trace-1", requestId: "req-1" },
    "run-1",
    "hash-1",
    stepResults,
  );

  const saved = await checkpointService.load("trace-1");
  assertEquals(saved?.completedSteps["step-1"]?.stepId, "step-1");
  assertEquals(eventLogger.events.some((e) => e.event.includes("checkpoint.saved") || e.event.includes("saved")), true);
});

Deno.test("[FlowCheckpointCoordinator] loadCheckpointIfAvailable restores step results and migrates to durability store", async () => {
  const checkpointService = new FakeCheckpointService();
  const flow = buildFlow();
  const seedResults = buildStepResults();
  await checkpointService.save("trace-2", "hash-2", {
    "step-1": {
      stepId: "step-1",
      success: true,
      duration: 10,
      startedAt: seedResults.get("step-1")!.startedAt.toISOString(),
      completedAt: seedResults.get("step-1")!.completedAt.toISOString(),
    },
  });

  const { coordinator, stepDurabilityStore } = makeCoordinator({ checkpointService });
  const restoredResults = new Map<string, IStepResult>();

  await coordinator.loadCheckpointIfAvailable(
    flow,
    { userPrompt: "do it", traceId: "trace-2", requestId: "req-2" },
    "run-2",
    "hash-2",
    restoredResults,
  );

  assertEquals(restoredResults.get("step-1")?.stepId, "step-1");
  assertEquals(stepDurabilityStore.saveCalls.length, 1);
  assertEquals(stepDurabilityStore.saveCalls[0]?.stepId, "step-1");
});

Deno.test("[FlowCheckpointCoordinator] loadCheckpointIfAvailable deletes and invalidates a stale checkpoint (hash mismatch)", async () => {
  const checkpointService = new FakeCheckpointService();
  const flow = buildFlow();
  await checkpointService.save("trace-3", "stale-hash", {
    "step-1": {
      stepId: "step-1",
      success: true,
      duration: 10,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
    },
  });

  const { coordinator, stepDurabilityStore, checkpointService: svc } = makeCoordinator({ checkpointService });
  const stepResults = new Map<string, IStepResult>();

  await coordinator.loadCheckpointIfAvailable(
    flow,
    { userPrompt: "do it", traceId: "trace-3", requestId: "req-3" },
    "run-3",
    "current-hash",
    stepResults,
  );

  assertEquals(stepResults.size, 0);
  assertEquals(await svc.load("trace-3"), null);
  assertEquals(stepDurabilityStore.invalidateCalls.length, 1);
  assertEquals(stepDurabilityStore.invalidateCalls[0]?.reason, "stale-checkpoint");
});

Deno.test("[FlowCheckpointCoordinator] clearCheckpointOnSuccess deletes checkpoint only when success is true", async () => {
  const { coordinator, checkpointService } = makeCoordinator();
  const flow = buildFlow();
  await checkpointService.save("trace-4", "hash-4", {});

  await coordinator.clearCheckpointOnSuccess(
    flow,
    { userPrompt: "do it", traceId: "trace-4", requestId: "req-4" },
    "run-4",
    false,
  );
  assertEquals(await checkpointService.load("trace-4") !== null, true);

  await coordinator.clearCheckpointOnSuccess(
    flow,
    { userPrompt: "do it", traceId: "trace-4", requestId: "req-4" },
    "run-4",
    true,
  );
  assertEquals(await checkpointService.load("trace-4"), null);
});

Deno.test("[FlowCheckpointCoordinator] no-ops gracefully when checkpointService is undefined", async () => {
  const eventLogger = new MockEventLogger();
  const stepDurabilityStore = new TrackingDurabilityStore();
  const coordinator = new FlowCheckpointCoordinator({
    checkpointService: undefined,
    stepDurabilityStore,
    eventLogger,
  });
  const flow = buildFlow();
  const stepResults = buildStepResults();

  await coordinator.loadCheckpointIfAvailable(
    flow,
    { userPrompt: "do it", traceId: "trace-5" },
    "run-5",
    "hash-5",
    stepResults,
  );
  await coordinator.saveCheckpointIfEnabled(
    flow,
    { userPrompt: "do it", traceId: "trace-5" },
    "run-5",
    "hash-5",
    stepResults,
  );
  await coordinator.clearCheckpointOnSuccess(
    flow,
    { userPrompt: "do it", traceId: "trace-5" },
    "run-5",
    true,
  );

  assertEquals(eventLogger.events.length, 0);
});
