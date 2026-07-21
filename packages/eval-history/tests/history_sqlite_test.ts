/**
 * @module EvalHistorySqliteTest
 * @path packages/eval-history/tests/history_sqlite_test.ts
 * @description Tests for SQLite-backed evaluation history store.
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { EvalSqliteStore, type IEvalHistoryEntry } from "@exaix/eval-history";

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

Deno.test("[ScenarioFrameworkHistorySqlite] initialize creates all tables and applies all migrations", () => {
  withStore((store) => {
    store.initialize();

    // Verify tables exist
    const tables = store["db"].prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all<{ name: string }>();

    const tableNames = tables.map((t) => t.name).sort();
    assertEquals(tableNames.includes("eval_runs"), true);
    assertEquals(tableNames.includes("eval_run_steps"), true);
    assertEquals(tableNames.includes("eval_criteria_results"), true);
    assertEquals(tableNames.includes("eval_schema_version"), true);

    // Verify all four migrations applied
    const versions = store["db"].prepare(
      "SELECT version, description FROM eval_schema_version ORDER BY version",
    ).all<{ version: number; description: string }>();
    assertEquals(versions.length, 4);
    assertEquals(versions[0].version, 1);
    assertEquals(versions[1].version, 2);
    assertEquals(versions[2].version, 3);
    assertEquals(versions[3].version, 4);

    // Verify v2 columns exist
    const hasBlueprintId = store["db"].prepare(
      "SELECT blueprint_id FROM eval_runs LIMIT 0",
    );
    hasBlueprintId.run(); // does not throw

    // Verify v3 columns exist on eval_criteria_results
    const hasScore = store["db"].prepare(
      "SELECT score FROM eval_criteria_results LIMIT 0",
    );
    hasScore.run(); // does not throw
  });
});

Deno.test("[ScenarioFrameworkHistorySqlite] re-initialization is idempotent", () => {
  withStore((store) => {
    store.initialize();
    store.initialize(); // second call should not throw
    const versionCount = store["db"].prepare(
      "SELECT COUNT(*) as cnt FROM eval_schema_version",
    ).get<{ cnt: number }>();
    // All migrations applied once, second initialize does not duplicate them
    assertEquals(versionCount?.cnt, 4);
  });
});

Deno.test("[ScenarioFrameworkHistorySqlite] upgrades from v1 schema to v2 without data loss", () => {
  // Simulate a v1 database by creating schema manually, writing data, then upgrading
  const dbDir = Deno.makeTempDirSync({ prefix: "scenario-framework-sqlite-migrate-" });
  const dbPath = join(dbDir, "eval.db");
  const legacyDb = new Database(dbPath);

  // Manually create v1 schema (simulate old database from initial release)
  legacyDb.exec(`CREATE TABLE IF NOT EXISTS eval_runs (
    run_id TEXT PRIMARY KEY, run_timestamp TEXT NOT NULL, scenario_id TEXT NOT NULL,
    pack TEXT NOT NULL DEFAULT '', suite_score REAL NOT NULL, passed INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'auto'
  )`);
  legacyDb.exec(`CREATE TABLE IF NOT EXISTS eval_run_steps (
    run_id TEXT NOT NULL, step_index INTEGER NOT NULL, step_id TEXT NOT NULL,
    score REAL NOT NULL, PRIMARY KEY (run_id, step_index)
  )`);
  legacyDb.exec(`CREATE TABLE IF NOT EXISTS eval_schema_version (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    description TEXT NOT NULL
  )`);
  legacyDb.exec(`INSERT INTO eval_schema_version (version, description) VALUES (1, 'v1')`);
  legacyDb.exec(`INSERT INTO eval_runs (run_id, run_timestamp, scenario_id, pack, suite_score, passed, mode)
    VALUES ('legacy-run', '2026-01-01T00:00:00Z', 'old-scenario', 'smoke', 0.75, 1, 'auto')`);
  legacyDb.close();

  // Re-open via store and upgrade via initialize()
  const upgradedStore = new EvalSqliteStore(dbPath);
  try {
    upgradedStore.initialize();

    // Verify legacy data survived
    const runs = upgradedStore.queryRuns({});
    assertEquals(runs.length, 1);
    assertEquals(runs[0].suite_score, 0.75);
    assertEquals(runs[0].passed, 1);

    // Verify v2 version recorded (query before write to test migration completed)
    upgradedStore.writeRun(makeTestEntry({
      run_id: "new-run",
      suite_score: 0.9,
    }));

    const newRun = upgradedStore.queryRuns({ scenario: "test-scenario" });
    assertEquals(newRun.length, 1);
    assertEquals(newRun[0].suite_score, 0.9);
  } finally {
    upgradedStore.close();
    try {
      Deno.removeSync(dbDir, { recursive: true });
    } catch { /* ok */ }
  }
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
