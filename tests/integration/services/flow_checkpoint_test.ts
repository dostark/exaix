/**
 * @module FlowCheckpointTest
 * @path tests/integration/services/flow_checkpoint_test.ts
 * @description Integration coverage for flow checkpoint save/load/resume lifecycle.
 * @architectural-layer Test
 * @related-files [packages/flow/src/flow_runner.ts, packages/flow/mod.ts]
 */

import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";
import { FlowExecutionError, FlowRunner } from "@exaix/flow";
import { type IFlow, type IFlowInput, ZFlowCheckpoint } from "@exaix/schemas/flow.ts";
import {
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  DEFAULT_FLOW_VERSION,
  FLOW_CHECKPOINT_SCHEMA_VERSION,
  FLOW_EVENT_CHECKPOINT_CLEARED,
  FLOW_EVENT_CHECKPOINT_LOADED,
  FLOW_EVENT_CHECKPOINT_SAVED,
  FLOW_EVENT_CHECKPOINT_STALE,
} from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import { getMemoryExecutionDir } from "@exaix/testing";
import { RecordingFlowLogger, ScriptedAgentExecutor } from "../../helpers/flow_namespace_test_helper.ts";

function createCheckpointFlow(
  id: string,
  name: string,
  description: string,
): IFlowInput {
  return {
    id,
    name,
    description,
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
        input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
      },
    ],
    output: { from: "step2", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };
}

function createFlowRunner(
  config: Awaited<ReturnType<typeof initTestDbService>>["config"],
  agentExecutor: ScriptedAgentExecutor,
  eventLogger: RecordingFlowLogger,
): FlowRunner {
  return new FlowRunner({
    agentExecutor,
    eventLogger,
    config,
  });
}

Deno.test("[Step63.3] FlowRunner checkpoints, resumes, and clears state after successful completion", async () => {
  const { config, tempDir, cleanup } = await initTestDbService();

  try {
    const traceId = "trace-flow-checkpoint-001";
    const requestId = "req-flow-checkpoint-001";

    const flow = createCheckpointFlow(
      "checkpoint-flow",
      "Checkpoint Flow",
      "Flow checkpoint integration coverage",
    );

    const firstRunExecutor = new ScriptedAgentExecutor({
      agent1: ["step1-result"],
      agent2: [new Error("step2 exploded")],
    });
    const firstRunLogger = new RecordingFlowLogger();
    const firstRunRunner = createFlowRunner(config, firstRunExecutor, firstRunLogger);

    await assertRejects(
      () => firstRunRunner.execute(flow as IFlow, { userPrompt: "checkpoint me", traceId, requestId }),
      FlowExecutionError,
    );

    const checkpointPath = join(getMemoryExecutionDir(tempDir), traceId, "checkpoint.json");
    assertEquals(await exists(checkpointPath), true);

    const checkpointRaw = await Deno.readTextFile(checkpointPath);
    const checkpoint = ZFlowCheckpoint.parse(JSON.parse(checkpointRaw));
    assertEquals(checkpoint.traceId, traceId);
    assertEquals(checkpoint.schemaVersion, FLOW_CHECKPOINT_SCHEMA_VERSION);
    assertEquals(Object.keys(checkpoint.completedSteps).sort(), ["step1"]);
    const savedEvent = firstRunLogger.events.find((entry) => entry.event === FLOW_EVENT_CHECKPOINT_SAVED);
    assertExists(savedEvent);
    assertEquals(typeof savedEvent.payload.flowRunId, "string");
    assertEquals(savedEvent.payload.traceId, traceId);
    assertEquals(typeof savedEvent.payload.completedSteps, "number");
    assert((savedEvent.payload.completedSteps as number) >= 1);

    const resumedExecutor = new ScriptedAgentExecutor({
      agent1: [new Error("step1 should not re-run")],
      agent2: ["step2-result"],
    });
    const resumedLogger = new RecordingFlowLogger();
    const resumedRunner = createFlowRunner(config, resumedExecutor, resumedLogger);

    const resumedStartedAt = performance.now();
    const resumedResult = await resumedRunner.execute(
      flow as IFlow,
      { userPrompt: "checkpoint me", traceId, requestId },
    );
    const resumedDurationMs = performance.now() - resumedStartedAt;

    assertEquals(resumedResult.success, true);
    assertEquals(resumedResult.output, "step2-result");
    assertEquals(resumedResult.stepResults.get("step1")?.result?.content, "step1-result");
    assertEquals(resumedExecutor.calls.includes("agent1"), false);
    assertEquals(resumedExecutor.calls.includes("agent2"), true);
    assertEquals(await exists(checkpointPath), false);
    assert(
      resumedDurationMs < 2000,
      `Expected checkpoint resume overhead under 2000ms, received ${resumedDurationMs.toFixed(2)}ms`,
    );

    const loadedEvent = resumedLogger.events.find((entry) => entry.event === FLOW_EVENT_CHECKPOINT_LOADED);
    assertExists(loadedEvent);
    assertEquals(loadedEvent.payload.traceId, traceId);
    assertEquals(typeof loadedEvent.payload.restoredSteps, "number");
    assert((loadedEvent.payload.restoredSteps as number) >= 1);
    assertEquals(loadedEvent?.payload.restoredSteps, 1);
    const clearedEvent = resumedLogger.events.find((entry) => entry.event === FLOW_EVENT_CHECKPOINT_CLEARED);
    assertExists(clearedEvent);
    assertEquals(resumedLogger.events.some((entry) => entry.event === FLOW_EVENT_CHECKPOINT_SAVED), true);
  } finally {
    await cleanup();
  }
});

Deno.test("[Step63.13] FlowRunner invalidates stale-hash checkpoints and reruns from step one", async () => {
  const { config, tempDir, cleanup } = await initTestDbService();

  try {
    const traceId = "trace-flow-checkpoint-stale-hash";
    const requestId = "req-flow-checkpoint-stale-hash";

    const originalFlow = createCheckpointFlow(
      "checkpoint-flow-stale-hash",
      "Checkpoint Flow Stale Hash",
      "Original flow definition for stale hash coverage",
    );

    const firstRunExecutor = new ScriptedAgentExecutor({
      agent1: ["step1-result"],
      agent2: [new Error("step2 exploded")],
    });
    const firstRunRunner = createFlowRunner(config, firstRunExecutor, new RecordingFlowLogger());

    await assertRejects(
      () => firstRunRunner.execute(originalFlow as IFlow, { userPrompt: "checkpoint me", traceId, requestId }),
      FlowExecutionError,
    );

    const checkpointPath = join(getMemoryExecutionDir(tempDir), traceId, "checkpoint.json");
    assertEquals(await exists(checkpointPath), true);

    const changedFlow: IFlowInput = {
      ...originalFlow,
      description: "Modified flow definition that should invalidate the old checkpoint",
    };

    const resumedExecutor = new ScriptedAgentExecutor({
      agent1: [new Error("step1 re-executed after stale checkpoint invalidation")],
      agent2: ["unused"],
    });
    const resumedLogger = new RecordingFlowLogger();
    const resumedRunner = createFlowRunner(config, resumedExecutor, resumedLogger);

    await assertRejects(
      () => resumedRunner.execute(changedFlow as IFlow, { userPrompt: "checkpoint me", traceId, requestId }),
      FlowExecutionError,
    );

    const staleEvent = resumedLogger.events.find((entry) => entry.event === FLOW_EVENT_CHECKPOINT_STALE);
    assertExists(staleEvent);
    assertEquals(staleEvent.payload.traceId, traceId);
    assertEquals(resumedExecutor.calls, ["agent1"]);
    assertEquals(await exists(checkpointPath), false);
  } finally {
    await cleanup();
  }
});

Deno.test("[Step63.10] FlowRunner invalidates checkpoint when schemaVersion is stale", async () => {
  const { config, tempDir, cleanup } = await initTestDbService();

  try {
    const traceId = "trace-flow-checkpoint-stale-version";
    const requestId = "req-flow-checkpoint-stale-version";

    const flow = createCheckpointFlow(
      "checkpoint-flow-stale-version",
      "Checkpoint Flow Stale Version",
      "Flow checkpoint invalidation when schemaVersion is stale",
    );

    const firstRunExecutor = new ScriptedAgentExecutor({
      agent1: ["stale-step1-result"],
      agent2: [new Error("step2 exploded")],
    });
    const firstRunLogger = new RecordingFlowLogger();
    const firstRunRunner = createFlowRunner(config, firstRunExecutor, firstRunLogger);

    await assertRejects(
      () => firstRunRunner.execute(flow as IFlow, { userPrompt: "checkpoint me", traceId, requestId }),
      FlowExecutionError,
    );

    const checkpointPath = join(getMemoryExecutionDir(tempDir), traceId, "checkpoint.json");
    const staleCheckpoint = {
      ...JSON.parse(await Deno.readTextFile(checkpointPath)),
      schemaVersion: "0",
    };
    await Deno.writeTextFile(checkpointPath, JSON.stringify(staleCheckpoint, null, 2));

    const resumedExecutor = new ScriptedAgentExecutor({
      agent1: ["fresh-step1-result"],
      agent2: ["fresh-step2-result"],
    });
    const resumedLogger = new RecordingFlowLogger();
    const resumedRunner = createFlowRunner(config, resumedExecutor, resumedLogger);

    const resumedResult = await resumedRunner.execute(
      flow as IFlow,
      { userPrompt: "checkpoint me", traceId, requestId },
    );

    assertEquals(resumedResult.success, true);
    assertEquals(resumedResult.stepResults.get("step1")?.result?.content, "fresh-step1-result");
    assertEquals(resumedExecutor.calls, ["agent1", "agent2"]);

    const staleEvent = resumedLogger.events.find((entry) => entry.event === FLOW_EVENT_CHECKPOINT_STALE);
    assert(staleEvent);
    assertEquals(staleEvent.payload.traceId, traceId);
  } finally {
    await cleanup();
  }
});
