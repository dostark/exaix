/**
 * @module MemoryCorpusVersionFieldTest
 * @path packages/eval-history/tests/memory_corpus_version_field_test.ts
 * @description Phase 148 Step 6 — RED-first tests. `memory_corpus_version` is an
 * additive optional field on `EvalHistoryEntrySchema` (the shared JSONL schema) and on
 * the SQLite `eval_runs` table, persisting through both eval-history backends and
 * staying absent/null on every pre-existing (non-memory) run. Deliberately a new,
 * purpose-named field rather than reusing `benchmark`/`benchmark_version` — those are
 * scoped to externally-sourced benchmarks (`TaskSourceSchema`), and the memory corpus
 * is Exaix-authored with no external benchmark dependency (see this phase's own
 * Design Decision 4 and Step 6's Codebase Grounding correction).
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/history_schema.ts, packages/eval-history/src/history_sqlite.ts, packages/eval-history/tests/external_provenance_fields_test.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EvalScoringMode } from "@exaix/core";
import { EvalHistoryEntrySchema } from "../src/history_schema.ts";
import { EvalSqliteStore } from "../src/history_sqlite.ts";

Deno.test("[MemoryCorpusVersionField] EvalHistoryEntrySchema accepts memory_corpus_version", () => {
  const parsed = EvalHistoryEntrySchema.parse({
    run_id: "run-1",
    scenario_id: "memory-info-extraction-basic",
    outcome: "success",
    mode: "auto",
    passed: true,
    timestamp: new Date().toISOString(),
    memory_corpus_version: "1.0.0",
  });

  assertEquals(parsed.memory_corpus_version, "1.0.0");
});

Deno.test("[MemoryCorpusVersionField] EvalHistoryEntrySchema omits memory_corpus_version cleanly (non-memory runs unaffected)", () => {
  const parsed = EvalHistoryEntrySchema.parse({
    run_id: "run-1",
    scenario_id: "swe-write-tests",
    outcome: "success",
    mode: "auto",
    passed: true,
    timestamp: new Date().toISOString(),
  });

  assertEquals(parsed.memory_corpus_version, undefined);
});

Deno.test("[MemoryCorpusVersionField] SQLite writeRun + queryRuns round-trips memory_corpus_version", () => {
  const dbPath = join(Deno.makeTempDirSync({ prefix: "eval-sqlite-memory-corpus-version-" }), "eval.db");
  const store = new EvalSqliteStore(dbPath);
  try {
    store.initialize();
    store.writeRun({
      run_id: "memory-run-1",
      scenario_id: "memory-info-extraction-basic",
      pack: "memory",
      outcome: "success",
      mode: "auto",
      scoring_mode: EvalScoringMode.ADDITIVE,
      suite_score: 1,
      passed: true,
      timestamp: new Date().toISOString(),
      memory_corpus_version: "1.0.0",
    }, []);

    const [row] = store.queryRuns({ scenario: "memory-info-extraction-basic" });
    assertEquals(row.memory_corpus_version, "1.0.0");
  } finally {
    store.close();
  }
});

Deno.test("[MemoryCorpusVersionField] a non-memory run persists NULL memory_corpus_version", () => {
  const dbPath = join(Deno.makeTempDirSync({ prefix: "eval-sqlite-memory-corpus-version-" }), "eval.db");
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
    assertEquals(row.memory_corpus_version, null);
  } finally {
    store.close();
  }
});
