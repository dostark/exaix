/**
 * @module StepDurabilityCheckpointMigrationTest
 * @path packages/flow/tests/step_durability_checkpoint_migration_test.ts
 * @description Integration tests verifying that FlowRunner populates the
 * step durability store from a restored checkpoint snapshot, ensuring resumed
 * flows leave an audit trail without enabling automatic replay of prior steps.
 */

import { assertEquals } from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import {
  FlowRunner,
  type IAgentExecutor,
  type IFlowCheckpointService,
  type IFlowEventLogger,
  type IFlowStepRequest,
  type IStepDurabilityStore,
  type IStepExecutionRecord,
} from "@exaix/flow";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IFlowCheckpoint } from "@exaix/schemas/flow.ts";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import type { JSONValue } from "@exaix/core";
import {
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  DEFAULT_FLOW_VERSION,
  FLOW_CHECKPOINT_SCHEMA_VERSION,
  FlowInputSource,
  FlowOutputFormat,
} from "@exaix/core";

// Test doubles

class TrackingDurabilityStore implements IStepDurabilityStore {
  saveCalls: Array<{ record: IStepExecutionRecord }> = [];
  records = new Map<string, IStepExecutionRecord>();

  save(record: IStepExecutionRecord): Promise<void> {
    this.saveCalls.push({ record });
    this.records.set(record.recordId, record);
    return Promise.resolve();
  }

  findReplayCandidate(
    query: Parameters<IStepDurabilityStore["findReplayCandidate"]>[0],
  ): Promise<IStepExecutionRecord | null> {
    for (const record of this.records.values()) {
      if (!record.replayEligible) continue;
      if (record.idempotencyKey.traceId !== query.traceId) continue;
      if (record.idempotencyKey.flowId !== query.flowId) continue;
      if (record.idempotencyKey.stepId !== query.stepId) continue;
      if (record.idempotencyKey.inputHash !== query.inputHash) continue;
      return Promise.resolve(record);
    }
    return Promise.resolve(null);
  }

  invalidate(_recordId: string, _reason: string): Promise<void> {
    return Promise.resolve();
  }

  get migrationRecords(): IStepExecutionRecord[] {
    return this.saveCalls.filter((c) => c.record.inputHash === "").map((c) => c.record);
  }

  get executionRecords(): IStepExecutionRecord[] {
    return this.saveCalls.filter((c) => c.record.inputHash !== "").map((c) => c.record);
  }
}

class SilentAgentRunner implements IAgentExecutor {
  callCount = 0;

  run(identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.callCount++;
    return Promise.resolve({ thought: "ok", content: `result-${identityId}`, raw: `raw-${identityId}` });
  }
}

class MockEventLogger implements IFlowEventLogger {
  events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>) {
    this.events.push({ event, payload });
  }
}

function buildCheckpointFlow(): IFlowInput {
  return {
    id: "checkpoint-flow",
    name: "Checkpoint Flow",
    description: "Flow used for checkpoint migration tests",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "agent1",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
      },
      {
        id: "step2",
        name: "Step 2",
        identity: "agent2",
        dependsOn: ["step1"],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
      },
    ],
    output: {
      from: ["step2"],
      format: FlowOutputFormat.MARKDOWN,
    },
    settings: { maxParallelism: 3, failFast: true },
  } as IFlowInput;
}

async function computeFlowHash(flow: IFlow): Promise<string> {
  const serialized = JSON.stringify(flow, (_key, value) => {
    return typeof value === "function" ? "__function__" : value;
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return encodeHex(digest);
}

function buildCheckpoint(traceId: string, flowContentHash: string): IFlowCheckpoint {
  const now = new Date().toISOString();
  return {
    traceId,
    flowContentHash,
    schemaVersion: FLOW_CHECKPOINT_SCHEMA_VERSION,
    completedSteps: {
      step1: {
        stepId: "step1",
        success: true,
        duration: 100,
        startedAt: now,
        completedAt: now,
      },
      step2: {
        stepId: "step2",
        success: true,
        duration: 200,
        startedAt: now,
        completedAt: now,
      },
    },
    savedAt: now,
  };
}

function buildMockCheckpointService(
  traceId: string,
  checkpoint: IFlowCheckpoint,
): IFlowCheckpointService {
  return {
    getCheckpointPath: () => "",
    load: (id) => Promise.resolve(id === traceId ? checkpoint : null),
    save: (_id, _hash, _steps) => Promise.resolve(checkpoint),
    delete: () => Promise.resolve(),
  };
}

// Tests

Deno.test(
  "StepDurabilityCheckpointMigration: populates store with one record per restored step",
  async () => {
    const store = new TrackingDurabilityStore();
    const flowDef = buildCheckpointFlow();
    const flow = flowDef as IFlow;
    const flowHash = await computeFlowHash(flow);
    const checkpoint = buildCheckpoint("migr-trace", flowHash);
    const cpService = buildMockCheckpointService("migr-trace", checkpoint);

    const runner = new FlowRunner({
      agentExecutor: new SilentAgentRunner(),
      eventLogger: new MockEventLogger(),
      stepDurabilityStore: store,
      checkpointService: cpService,
    });

    const result = await runner.execute(flow, { userPrompt: "test", traceId: "migr-trace" });

    assertEquals(result.success, true);

    // One migration record per checkpoint step
    assertEquals(store.migrationRecords.length, 2, "Should have 2 migration records");

    // Step IDs are present
    const stepIds = store.migrationRecords.map((r) => r.stepId).sort();
    assertEquals(stepIds, ["step1", "step2"]);

    // Migration records are NOT replay-eligible (audit trail only)
    for (const record of store.migrationRecords) {
      assertEquals(record.replayEligible, false, `Record ${record.stepId} should not be replay-eligible`);
      assertEquals(record.inputHash, "", "Migration records use empty inputHash sentinel");
      assertEquals(record.traceId, "migr-trace");
      assertEquals(record.flowId, "checkpoint-flow");
    }
  },
);

Deno.test(
  "StepDurabilityCheckpointMigration: migration records do not match findReplayCandidate queries",
  async () => {
    const store = new TrackingDurabilityStore();
    const flowDef = buildCheckpointFlow();
    const flow = flowDef as IFlow;
    const flowHash = await computeFlowHash(flow);
    const checkpoint = buildCheckpoint("query-trace", flowHash);
    const cpService = buildMockCheckpointService("query-trace", checkpoint);

    const runner = new FlowRunner({
      agentExecutor: new SilentAgentRunner(),
      eventLogger: new MockEventLogger(),
      stepDurabilityStore: store,
      checkpointService: cpService,
    });

    await runner.execute(flow, { userPrompt: "test", traceId: "query-trace" });

    // Migration records have inputHash "" which never matches a real hash query
    const candidate = await store.findReplayCandidate({
      traceId: "query-trace",
      flowId: "checkpoint-flow",
      stepId: "step1",
      inputHash: "",
      attemptClass: "resume",
    });
    assertEquals(candidate, null, "Migration records must not be replay-eligible for findReplayCandidate");
  },
);

Deno.test(
  "StepDurabilityCheckpointMigration: no double migration on second execute with same traceId",
  async () => {
    const store = new TrackingDurabilityStore();
    const flowDef = buildCheckpointFlow();
    const flow = flowDef as IFlow;
    const flowHash = await computeFlowHash(flow);
    const checkpoint = buildCheckpoint("idempotent-trace", flowHash);
    const cpService = buildMockCheckpointService("idempotent-trace", checkpoint);

    const runner = new FlowRunner({
      agentExecutor: new SilentAgentRunner(),
      eventLogger: new MockEventLogger(),
      stepDurabilityStore: store,
      checkpointService: cpService,
    });

    // First run — should migrate
    await runner.execute(flow, { userPrompt: "test", traceId: "idempotent-trace" });
    const firstRunMigrations = store.migrationRecords.length;
    assertEquals(firstRunMigrations, 2, "First run should create 2 migration records");

    // Second run on the same FlowRunner instance with the same traceId — no additional migration
    await runner.execute(flow, { userPrompt: "test", traceId: "idempotent-trace" });
    const totalMigrations = store.migrationRecords.length;
    assertEquals(totalMigrations, 2, "Second run should NOT add more migration records");
  },
);

Deno.test(
  "StepDurabilityCheckpointMigration: no migration records when no checkpoint service is configured",
  async () => {
    const store = new TrackingDurabilityStore();
    const agent = new SilentAgentRunner();

    // No checkpointService provided — FlowRunner has no checkpoint at all
    const runner = new FlowRunner({
      agentExecutor: agent,
      eventLogger: new MockEventLogger(),
      stepDurabilityStore: store,
    });

    const result = await runner.execute(buildCheckpointFlow() as IFlow, {
      userPrompt: "fresh run",
      traceId: "no-cp-trace",
    });

    assertEquals(result.success, true);
    assertEquals(agent.callCount, 2, "Both steps should execute normally");

    // No migration records (inputHash === "") — only real execution records
    assertEquals(store.migrationRecords.length, 0, "No migration records without a checkpoint");
    assertEquals(store.executionRecords.length > 0, true, "Execution records do exist");
  },
);
