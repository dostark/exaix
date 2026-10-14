#!/usr/bin/env -S deno run -A
/**
 * @module BenchLintRules
 * @path scripts/bench_lint_rules.ts
 * @description Benchmarks the exaix lint plugin. Runs `deno lint` three times,
 *   reports the median, and supports a saved baseline.
 *   Usage: deno run -A scripts/bench_lint_rules.ts [--save <file>] [--compare <file>]
 */

import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const RUNS = 3;

interface IBenchResult {
  readonly medianMs: number;
  readonly samples: number[];
}

async function runLintOnce(): Promise<number> {
  const start = performance.now();
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "lint",
      "--rules-include=explicit-module-boundary-types",
      "--rules-exclude=no-import-prefix",
      "tests/",
      "packages/",
      "exaix-team/",
      "apps/",
    ],
    cwd: REPO_ROOT,
    stdout: "null",
    stderr: "null",
  });
  await command.output();
  return performance.now() - start;
}

async function bench(): Promise<IBenchResult> {
  const samples: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    samples.push(await runLintOnce());
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)], samples };
}

function argValue(flag: string): string | undefined {
  const index = Deno.args.indexOf(flag);
  return index !== -1 ? Deno.args[index + 1] : undefined;
}

const result = await bench();
console.log(
  `lint median: ${result.medianMs.toFixed(0)} ms (samples: ${result.samples.map((s) => s.toFixed(0)).join(", ")})`,
);

const savePath = argValue("--save");
if (savePath) {
  await Deno.writeTextFile(savePath, JSON.stringify(result, null, 2));
  console.log(`saved baseline to ${savePath}`);
}

const comparePath = argValue("--compare");
if (comparePath) {
  const baseline = JSON.parse(await Deno.readTextFile(comparePath)) as IBenchResult;
  const delta = result.medianMs - baseline.medianMs;
  console.log(`baseline: ${baseline.medianMs.toFixed(0)} ms, delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(0)} ms`);
}
