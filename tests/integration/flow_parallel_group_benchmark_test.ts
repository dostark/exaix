/**
 * @module ParallelGroupBenchmarkIntegrationTest
 * @path tests/integration/flow_parallel_group_benchmark_test.ts
 * @description Measures the wall-clock reduction of grouped concurrent review steps
 *   against a sequential baseline, guarding the Phase 65 success metric.
 * @architectural-layer Tests
 * @related-files [packages/flow/src/flow_runner.ts, packages/flow/src/wave_orchestrator.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";
import { FlowRunner, type IAgentExecutor } from "@exaix/flow";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import { DEFAULT_FLOW_STEP_BACKOFF_MS, DEFAULT_FLOW_VERSION, FLOW_EVENT_PARALLEL_GROUP_STARTED } from "@exaix/core";
import { RecordingFlowLogger } from "../helpers/flow_namespace_test_helper.ts";

/** Deterministic per-step delay so the timing assertion is stable without real model latency. */
const BENCHMARK_STEP_DELAY_MS = 150;

/** Minimum wall-clock reduction the grouped fixture must achieve over the sequential baseline. */
const FLOW_PARALLEL_GROUP_BENCHMARK_MIN_REDUCTION = 0.3;

class DelayedAgentExecutor implements IAgentExecutor {
  readonly calls: string[] = [];

  async run(agentRole: string): Promise<IAgentExecutionResult> {
    this.calls.push(agentRole);
    await new Promise((resolve) => setTimeout(resolve, BENCHMARK_STEP_DELAY_MS));
    return { thought: `processed ${agentRole}`, content: `${agentRole} result`, raw: `${agentRole} raw` };
  }
}

/** Two review steps. Grouped versions share a wave while the sequential baseline chains them. */
function buildBenchmarkFlow(id: string, grouped: boolean): IFlowInput {
  return {
    id,
    name: grouped ? "Grouped Review Benchmark" : "Sequential Review Benchmark",
    description: "Two independent review steps for grouped-vs-sequential wall-clock measurement",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "review-a",
        name: "Review A",
        agent_role: "reviewer-a",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        ...(grouped ? { parallel: { group: "reviewers" } } : {}),
      },
      {
        id: "review-b",
        name: "Review B",
        agent_role: "reviewer-b",
        dependsOn: grouped ? [] : ["review-a"],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        ...(grouped ? { parallel: { group: "reviewers" } } : {}),
      },
    ],
    output: { from: ["review-a", "review-b"], format: FlowOutputFormat.CONCAT },
    settings: { maxParallelism: 4, failFast: true },
  };
}

async function runTimed(runner: FlowRunner, flow: IFlowInput): Promise<number> {
  const startedAt = performance.now();
  await runner.execute(flow as IFlow, { userPrompt: "benchmark", requestId: flow.id });
  return performance.now() - startedAt;
}

Deno.test("FlowRunner: grouped execution is at least the target fraction faster than sequential for two independent steps", async () => {
  const sequentialRunner = new FlowRunner({
    agentExecutor: new DelayedAgentExecutor(),
    eventLogger: new RecordingFlowLogger(),
  });
  const sequentialMs = await runTimed(sequentialRunner, buildBenchmarkFlow("review-sequential", false));

  const groupedLogger = new RecordingFlowLogger();
  const groupedRunner = new FlowRunner({
    agentExecutor: new DelayedAgentExecutor(),
    eventLogger: groupedLogger,
  });
  const groupedMs = await runTimed(groupedRunner, buildBenchmarkFlow("review-grouped", true));

  const maxGroupedMs = sequentialMs * (1 - FLOW_PARALLEL_GROUP_BENCHMARK_MIN_REDUCTION);
  assert(
    groupedMs <= maxGroupedMs,
    `Grouped wall-clock ${groupedMs.toFixed(1)}ms must be at most ${maxGroupedMs.toFixed(1)}ms ` +
      `(a ${(FLOW_PARALLEL_GROUP_BENCHMARK_MIN_REDUCTION * 100).toFixed(0)}% reduction from ` +
      `the sequential baseline ${sequentialMs.toFixed(1)}ms)`,
  );

  const groupStarted = groupedLogger.events.some((entry) => entry.event === FLOW_EVENT_PARALLEL_GROUP_STARTED);
  assertEquals(groupStarted, true);
});
