/**
 * @module ExternalBenchmark
 * @path packages/eval-history/src/external_benchmark.ts
 * @description Phase 144 Step 4 — shared constants for the external-benchmark comparability
 * view. The caveat text is the single source of truth for both the `exactl eval report
 * --view external` renderer and the Phase 144 Step 6 docs, so report and docs can never drift.
 * @architectural-layer Shared
 * @related-files [packages/eval-history/mod.ts, apps/exactl/src/commands/eval_commands.ts]
 */

/** Caveat block rendered below the external-benchmark comparability table and quoted verbatim
 *  in the Phase 144 Step 6 docs. Derived-methodology label + contamination note: external
 *  figures come from scoring on the benchmark's own tests rather than Exaix-native scenarios,
 *  so they are comparative signals, not certifications. */
export const EXTERNAL_BENCHMARK_CAVEAT =
  "External-benchmark results are derived, not native: each task is scored on the benchmark's " +
  "own tests, per-cell runs are independent, and figures may not generalize to later revisions " +
  "of the benchmark (contamination risk). Treat them as comparative signals, not certifications.";
