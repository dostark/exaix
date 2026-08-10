/**
 * @module ExternalProvenanceFieldsTest
 * @path packages/eval-history/tests/external_provenance_fields_test.ts
 * @description Phase 144 Step 4 — RED-first tests. `benchmark` + `benchmark_version` are
 * additive optional fields on EvalHistoryEntrySchema (the shared JSONL schema) and on the
 * SQLite `eval_runs` table, persisting through both eval-history backends and staying
 * absent/null on every pre-existing (non-external) run.
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/history_schema.ts, packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EvalScoringMode } from "@exaix/core";
import { EvalHistoryEntrySchema } from "../src/history_schema.ts";
import { EvalSqliteStore } from "../src/history_sqlite.ts";

Deno.test("[ExternalProvenanceFields] EvalHistoryEntrySchema accepts benchmark + benchmark_version", () => {
  const parsed = EvalHistoryEntrySchema.parse({
    run_id: "run-1",
    scenario_id: "external-terminal-bench-log-summary",
    outcome: "success",
    mode: "auto",
    passed: true,
    timestamp: new Date().toISOString(),
    benchmark: "terminal-bench",
    benchmark_version: "d28711d0da2675d0bb1d56de45ae5df6082438a3",
  });

  assertEquals(parsed.benchmark, "terminal-bench");
  assertEquals(parsed.benchmark_version, "d28711d0da2675d0bb1d56de45ae5df6082438a3");
});

Deno.test("[ExternalProvenanceFields] EvalHistoryEntrySchema omits benchmark fields cleanly (non-external runs unaffected)", () => {
  const parsed = EvalHistoryEntrySchema.parse({
    run_id: "run-1",
    scenario_id: "swe-write-tests",
    outcome: "success",
    mode: "auto",
    passed: true,
    timestamp: new Date().toISOString(),
  });

  assertEquals(parsed.benchmark, undefined);
  assertEquals(parsed.benchmark_version, undefined);
});

Deno.test("[ExternalProvenanceFields] SQLite writeRun + queryRuns round-trips benchmark + benchmark_version", () => {
  const dbPath = join(Deno.makeTempDirSync({ prefix: "eval-sqlite-external-provenance-" }), "eval.db");
  const store = new EvalSqliteStore(dbPath);
  try {
    store.initialize();
    store.writeRun({
      run_id: "external-run-1",
      scenario_id: "external-terminal-bench-log-summary",
      pack: "external_terminal_bench",
      outcome: "success",
      mode: "auto",
      scoring_mode: EvalScoringMode.ADDITIVE,
      suite_score: 1,
      passed: true,
      timestamp: new Date().toISOString(),
      cell_id: "claude-code/anthropic",
      provider: "anthropic",
      model: "claude-sonnet",
      benchmark: "terminal-bench",
      benchmark_version: "d28711d0da2675d0bb1d56de45ae5df6082438a3",
    }, []);

    const [row] = store.queryRuns({ scenario: "external-terminal-bench-log-summary" });
    assertEquals(row.benchmark, "terminal-bench");
    assertEquals(row.benchmark_version, "d28711d0da2675d0bb1d56de45ae5df6082438a3");
  } finally {
    store.close();
  }
});

Deno.test("[ExternalProvenanceFields] a non-external run persists NULL benchmark + benchmark_version", () => {
  const dbPath = join(Deno.makeTempDirSync({ prefix: "eval-sqlite-external-provenance-" }), "eval.db");
  const store = new EvalSqliteStore(dbPath);
  try {
    store.initialize();
    store.writeRun({
      run_id: "internal-run-1",
      scenario_id: "swe-write-tests",
      outcome: "success",
      mode: "auto",
      scoring_mode: EvalScoringMode.ADDITIVE,
      suite_score: 1,
      passed: true,
      timestamp: new Date().toISOString(),
    }, []);

    const [row] = store.queryRuns({ scenario: "swe-write-tests" });
    assertEquals(row.benchmark, null);
    assertEquals(row.benchmark_version, null);
  } finally {
    store.close();
  }
});
