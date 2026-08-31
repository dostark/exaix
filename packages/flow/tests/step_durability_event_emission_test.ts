/**
 * @module StepDurabilityEventEmissionTest
 * @path packages/flow/tests/step_durability_event_emission_test.ts
 * @description Tests verifying that FlowRunner emits the correct step durability
 * events: FLOW_EVENT_STEP_SKIPPED_BY_REUSE on reuse paths and
 * DomainEventType.FlowStepInvalidated when a stale checkpoint is detected. Regression
 * guard: DomainEventType.FlowStepReplayed must NOT be emitted on the current reuse path.
 */

import { assertEquals, assertFalse } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
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
  FLOW_EVENT_STEP_SKIPPED_BY_REUSE,
  FlowInputSource,
  FlowOutputFormat,
  StepAttemptClass,
  StepExecutionDisposition,
  StepSideEffectClass,
} from "@exaix/core";

// Test doubles

/** Captures all emitted events for assertion. */
class TrackingEventLogger implements IFlowEventLogger {
  events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>): void {
    this.events.push({ event, payload });
  }

  emittedEventNames(): string[] {
    return this.events.map((e) => e.event);
  }

  eventsFor(name: string): Array<{ event: string; payload: Record<string, JSONValue | undefined> }> {
    return this.events.filter((e) => e.event === name);
  }
}

/** Always returns the same pre-set reusable record for any findReplayCandidate query. */
class FixedReplayStore implements IStepDurabilityStore {
  readonly reusableRecord: IStepExecutionRecord;
  invalidateCalls: Array<{ recordId: string; reason: string }> = [];

  constructor(reusableRecord: IStepExecutionRecord) {
    this.reusableRecord = reusableRecord;
  }

  save(_record: IStepExecutionRecord): Promise<void> {
    return Promise.resolve();
  }

  findReplayCandidate(
    _query: Parameters<IStepDurabilityStore["findReplayCandidate"]>[0],
  ): Promise<IStepExecutionRecord | null> {
    return Promise.resolve(this.reusableRecord);
  }

  invalidate(recordId: string, reason: string): Promise<void> {
    this.invalidateCalls.push({ recordId, reason });
    return Promise.resolve();
  }
}

/** Records invalidate calls but never returns replay candidates. */
class TrackingInvalidationStore implements IStepDurabilityStore {
  invalidateCalls: Array<{ recordId: string; reason: string }> = [];

  save(_record: IStepExecutionRecord): Promise<void> {
    return Promise.resolve();
  }

  findReplayCandidate(
    _query: Parameters<IStepDurabilityStore["findReplayCandidate"]>[0],
  ): Promise<IStepExecutionRecord | null> {
    return Promise.resolve(null);
  }

  invalidate(recordId: string, reason: string): Promise<void> {
    this.invalidateCalls.push({ recordId, reason });
    return Promise.resolve();
  }
}

class SilentAgentRunner implements IAgentExecutor {
  run(identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    return Promise.resolve({ thought: "ok", content: `result-${identityId}`, raw: `raw-${identityId}` });
  }
}

// Flow and record builders

function buildTwoStepFlow(): IFlowInput {
  return {
    id: "event-emission-flow",
    name: "Event Emission Flow",
    description: "Flow for testing event emission",
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

function buildReusableRecord(stepId: string, flowId: string, traceId: string): IStepExecutionRecord {
  return {
    recordId: `prior-${stepId}`,
    traceId,
    flowId,
    stepId,
    idempotencyKey: {
      traceId,
      flowId,
      stepId,
      attemptClass: StepAttemptClass.INITIAL,
      inputHash: "prior-hash",
    },
    disposition: StepExecutionDisposition.EXECUTED,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    inputHash: "prior-hash",
    sideEffectClass: StepSideEffectClass.LLM,
    replayEligible: true,
    summary: "prior result",
  };
}

function buildStaleCheckpointService(traceId: string): IFlowCheckpointService {
  const now = new Date().toISOString();
  const checkpoint: IFlowCheckpoint = {
    traceId,
    flowContentHash: "0000000000000000000000000000000000000000000000000000000000000000",
    schemaVersion: FLOW_CHECKPOINT_SCHEMA_VERSION,
    completedSteps: {
      step1: {
        stepId: "step1",
        success: true,
        duration: 100,
        startedAt: now,
        completedAt: now,
      },
    },
    savedAt: now,
  };
  return {
    getCheckpointPath: () => "",
    load: (id) => Promise.resolve(id === traceId ? checkpoint : null),
    save: (_id, _hash, _steps) => Promise.resolve(checkpoint),
    delete: () => Promise.resolve(),
  };
}

// Tests

Deno.test(
  "StepDurabilityEventEmission: emits FLOW_EVENT_STEP_SKIPPED_BY_REUSE when prior reusable record exists",
  async () => {
    const flow = buildTwoStepFlow() as IFlow;
    const logger = new TrackingEventLogger();
    const store = new FixedReplayStore(
      buildReusableRecord("step1", flow.id, "reuse-trace"),
    );

    const runner = new FlowRunner({
      agentExecutor: new SilentAgentRunner(),
      eventLogger: logger,
      stepDurabilityStore: store,
    });

    const result = await runner.execute(flow, { userPrompt: "test", traceId: "reuse-trace" });

    assertEquals(result.success, true);

    const reuseEvents = logger.eventsFor(FLOW_EVENT_STEP_SKIPPED_BY_REUSE);
    assertEquals(reuseEvents.length > 0, true, "FLOW_EVENT_STEP_SKIPPED_BY_REUSE must be emitted at least once");

    const step1Events = reuseEvents.filter((e) => e.payload["stepId"] === "step1");
    assertEquals(step1Events.length, 1, "Exactly one SKIPPED_BY_REUSE event for step1");

    const payload = step1Events[0].payload;
    assertEquals(payload["priorRecordId"], `prior-step1`, "Payload must include priorRecordId");
    assertEquals(typeof payload["inputHash"], "string", "Payload must include inputHash");
    assertEquals(typeof payload["flowRunId"], "string", "Payload must include flowRunId");
  },
);

Deno.test(
  "StepDurabilityEventEmission: does NOT emit DomainEventType.FlowStepReplayed on the reuse path",
  async () => {
    const flow = buildTwoStepFlow() as IFlow;
    const logger = new TrackingEventLogger();
    const store = new FixedReplayStore(
      buildReusableRecord("step1", flow.id, "no-replayed-trace"),
    );

    const runner = new FlowRunner({
      agentExecutor: new SilentAgentRunner(),
      eventLogger: logger,
      stepDurabilityStore: store,
    });

    await runner.execute(flow, { userPrompt: "test", traceId: "no-replayed-trace" });

    assertFalse(
      logger.emittedEventNames().includes(DomainEventType.FlowStepReplayed),
      "DomainEventType.FlowStepReplayed must NOT be emitted on the current byte-reuse path",
    );
  },
);

Deno.test(
  "StepDurabilityEventEmission: emits DomainEventType.FlowStepInvalidated when stale checkpoint detected",
  async () => {
    const flow = buildTwoStepFlow() as IFlow;
    const logger = new TrackingEventLogger();
    const store = new TrackingInvalidationStore();
    const cpService = buildStaleCheckpointService("stale-trace");

    const runner = new FlowRunner({
      agentExecutor: new SilentAgentRunner(),
      eventLogger: logger,
      stepDurabilityStore: store,
      checkpointService: cpService,
    });

    const result = await runner.execute(flow, { userPrompt: "test", traceId: "stale-trace" });

    assertEquals(result.success, true);

    const invalidatedEvents = logger.eventsFor(DomainEventType.FlowStepInvalidated);
    assertEquals(
      invalidatedEvents.length > 0,
      true,
      "DomainEventType.FlowStepInvalidated must be emitted for stale checkpoint steps",
    );

    const step1Inv = invalidatedEvents.filter((e) => e.payload["stepId"] === "step1");
    assertEquals(step1Inv.length, 1, "One STEP_INVALIDATED event per stale checkpoint step");

    const payload = step1Inv[0].payload;
    assertEquals(payload["reason"], "stale-checkpoint", "Reason must be 'stale-checkpoint'");
    assertEquals(typeof payload["recordId"], "string", "Payload must include recordId");

    // store.invalidate should also have been called
    const invCalls = store.invalidateCalls.filter((c) => c.recordId.includes("step1"));
    assertEquals(invCalls.length, 1, "store.invalidate must be called for step1");
    assertEquals(invCalls[0].reason, "stale-checkpoint");
  },
);
