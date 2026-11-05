#!/usr/bin/env -S deno run -A
/**
 * @module BenchFixture
 * @path tests/scenario_framework/fixtures/portals/p234_s1/scripts/bench.ts
 * @description Runs the latency workload for one worker count.
 * @architectural-layer Test
 * @related-files [../src/perf_bench.ts]
 */
import { runWorkload } from "../src/perf_bench.ts";

const index = Deno.args.indexOf("--workers");
const workers = index < 0 ? 2 : Number(Deno.args[index + 1]);
const samples = [runWorkload(workers), runWorkload(workers), runWorkload(workers)];
const latencyMs = samples.sort((left, right) => left - right)[1];

console.log(JSON.stringify({ workers, latencyMs }));
