/**
 * @module MilestonePerfBenchmark
 * @path packages/flow/tests/milestone_perf_benchmark.ts
 * @description Benchmark measuring median overhead of milestone emission
 * across 1,000 iterations, asserting < 5ms median per call.
 * @architectural-layer Tests
 * @related-files [packages/core/src/observability/milestone_emitter.ts, packages/schemas/src/milestone_event.ts]
 */
import { assert } from "@std/assert";
import type { IExecutionMilestone } from "@exaix/schemas";
import { NoopMilestoneEmitter } from "@exaix/core/observability";

function makeMilestone(): IExecutionMilestone {
  return {
    milestoneId: crypto.randomUUID(),
    traceId: "benchmark-trace",
    milestoneType: "flow.step.started",
    requiresAttention: false,
    occurredAt: new Date().toISOString(),
    summary: "Benchmark milestone",
  };
}

Deno.test({
  name: "Milestone emission overhead < 5ms median across 1,000 iterations",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const emitter = new NoopMilestoneEmitter();
    const milestone = makeMilestone();
    const iterations = 1_000;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await emitter.emit(milestone);
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
    }

    latencies.sort((a, b) => a - b);
    const median = latencies.length % 2 === 0
      ? (latencies[latencies.length / 2 - 1] + latencies[latencies.length / 2]) / 2
      : latencies[Math.floor(latencies.length / 2)];

    assert(median < 5, `Median milestone emission overhead ${median}ms exceeds 5ms budget`);
  },
});
