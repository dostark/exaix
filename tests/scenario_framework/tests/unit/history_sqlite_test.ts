/**
 * @module ScenarioFrameworkHistorySqliteTest
 * @path tests/scenario_framework/tests/unit/history_sqlite_test.ts
 * @description Tests for SQLite-backed evaluation history store.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/history_sqlite.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EvalSqliteStore } from "../../runner/history_sqlite.ts";
import type { IEvalHistoryEntry } from "../../schema/history_schema.ts";

function makeTestEntry(overrides: Partial<IEvalHistoryEntry> = {}): IEvalHistoryEntry {
  return {
    run_id: crypto.randomUUID(),
    scenario_id: "test-scenario",
    pack: "smoke",
    outcome: "success",
    mode: "auto",
    suite_score: 0.95,
    passed: true,
    timestamp: new Date().toISOString(),
    component_versions: { binary_version: "1.0.3", schema_version: "1.5.0" },
    ...overrides,
  };
}

function withStore(fn: (store: EvalSqliteStore, dbPath: string) => void): void {
  const dbPath = join(Deno.makeTempDirSync({ prefix: "scenario-framework-sqlite-" }), "eval.db");
  const store = new EvalSqliteStore(dbPath);
  try {
    fn(store, dbPath);
  } finally {
    store.close();
    try {
      Deno.removeSync(dbPath);
    } catch { /* ok */ }
  }
}

Deno.test("[ScenarioFrameworkHistorySqlite] initialize creates all three tables and version row", () => {
  withStore((store) => {
    store.initialize();

    // Verify tables exist by querying sqlite_master
    const tables = store["db"].prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all<{ name: string }>();

    const tableNames = tables.map((t) => t.name).sort();
    assertEquals(tableNames.includes("eval_runs"), true);
    assertEquals(tableNames.includes("eval_run_steps"), true);
    assertEquals(tableNames.includes("eval_criteria_results"), true);
    assertEquals(tableNames.includes("eval_schema_version"), true);

    const versionRow = store["db"].prepare(
      "SELECT version, description FROM eval_schema_version WHERE version = 1",
    ).get<{ version: number; description: string }>();
    assertEquals(versionRow?.version, 1);
  });
});

Deno.test("[ScenarioFrameworkHistorySqlite] re-initialization is idempotent", () => {
  withStore((store) => {
    store.initialize();
    store.initialize(); // second call should not throw
    const versionCount = store["db"].prepare(
      "SELECT COUNT(*) as cnt FROM eval_schema_version",
    ).get<{ cnt: number }>();
    assertEquals(versionCount?.cnt, 1);
  });
});

Deno.test("[ScenarioFrameworkHistorySqlite] write and read-back preserves run fields", () => {
  withStore((store) => {
    store.initialize();
    const entry = makeTestEntry({ suite_score: 0.85, passed: true });
    store.writeRun(entry);

    const runs = store.queryRuns({});
    assertEquals(runs.length, 1);
    assertEquals(runs[0].run_id, entry.run_id);
    assertEquals(runs[0].scenario_id, "test-scenario");
    assertEquals(runs[0].pack, "smoke");
    assertEquals(runs[0].suite_score, 0.85);
    assertEquals(runs[0].passed, 1);
  });
});

Deno.test("[ScenarioFrameworkHistorySqlite] query runs by scenario and pack", () => {
  withStore((store) => {
    store.initialize();
    store.writeRun(makeTestEntry({ run_id: "run-1", scenario_id: "scenario-a", pack: "smoke" }));
    store.writeRun(makeTestEntry({ run_id: "run-2", scenario_id: "scenario-b", pack: "core" }));
    store.writeRun(makeTestEntry({ run_id: "run-3", scenario_id: "scenario-a", pack: "smoke" }));

    const scenarioA = store.queryRuns({ scenario: "scenario-a" });
    assertEquals(scenarioA.length, 2);

    const smokePack = store.queryRuns({ pack: "smoke" });
    assertEquals(smokePack.length, 2);
  });
});

Deno.test("[ScenarioFrameworkHistorySqlite] query --last 3 returns most recent runs", () => {
  withStore((store) => {
    store.initialize();
    for (let i = 0; i < 5; i++) {
      store.writeRun(makeTestEntry({
        run_id: `run-${i}`,
        scenario_id: "perf-test",
        suite_score: 0.5 + i * 0.1,
        timestamp: new Date(Date.now() + i * 1000).toISOString(), // each 1s apart
      }));
    }

    const last3 = store.queryRuns({ scenario: "perf-test", last: 3 });
    assertEquals(last3.length, 3);
    // Most recent first: run-4, run-3, run-2
    assertEquals(last3[0].run_id, "run-4");
    assertEquals(last3[2].run_id, "run-2");
  });
});

Deno.test("[ScenarioFrameworkHistorySqlite] compareRuns returns correct score delta", () => {
  withStore((store) => {
    store.initialize();
    store.writeRun(makeTestEntry({
      run_id: "run-a",
      suite_score: 0.7,
      timestamp: "2026-06-09T12:00:00.000Z",
    }));
    store.writeRun(makeTestEntry({
      run_id: "run-b",
      suite_score: 0.9,
      timestamp: "2026-06-09T13:00:00.000Z",
    }));

    const result = store.compareRuns("run-a", "run-b");
    assertEquals(result.runA?.run_id, "run-a");
    assertEquals(result.runA?.suite_score, 0.7);
    assertEquals(result.runB?.run_id, "run-b");
    assertEquals(result.runB?.suite_score, 0.9);
    assertEquals(Math.round(result.scoreDelta * 100) / 100, 0.2);
  });
});

Deno.test("[ScenarioFrameworkHistorySqlite] cleanup removes runs beyond retention", () => {
  withStore((store) => {
    store.initialize();
    for (let i = 0; i < 5; i++) {
      store.writeRun(makeTestEntry({
        run_id: `run-${i}`,
        scenario_id: "cleanup-test",
        suite_score: 0.5 + i * 0.1,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      }));
    }

    const deleted = store.cleanup(2); // retain 2 latest
    assertEquals(deleted > 0, true);

    const remaining = store.queryRuns({ scenario: "cleanup-test" });
    assertEquals(remaining.length, 2);
    assertEquals(remaining[0].run_id, "run-4");
    assertEquals(remaining[1].run_id, "run-3");
  });
});
