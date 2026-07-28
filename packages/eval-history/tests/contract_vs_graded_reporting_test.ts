/**
 * @module ContractVsGradedReportingTest
 * @path packages/eval-history/tests/contract_vs_graded_reporting_test.ts
 * @description Phase 142 Step 7 — a summary row must say how many scenarios passed, and offer a
 *   mean only where the underlying criteria are graded.
 *
 *   Most subsystem packs ask yes/no questions: the pinned skill reached the prompt or it did not.
 *   Reporting `MEAN 1.000` over such a pack invites reading a drop to 0.971 as "97% healthy" when
 *   it means "one assertion of many broke" — which is exactly how a dead feature looked in Step 17.
 *   `7/7` says what actually happened.
 *
 *   Gradedness is derived from the observed scores rather than from a hand-maintained list of which
 *   packs are "contract packs". A mean carries information precisely when some score falls strictly
 *   between 0 and 1; if every run scored exactly 0 or 1 the mean is just the pass rate wearing three
 *   decimal places. Deriving it also self-corrects: a pack that gains an llm-judge criterion starts
 *   reporting a mean without anyone remembering to reclassify it.
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/history_sqlite.ts, apps/exactl/src/commands/eval_commands.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { EvalSqliteStore } from "../src/history_sqlite.ts";
import type { IEvalHistoryEntry } from "../src/history_schema.ts";
import { getDefaultComponentVersions } from "../src/history_schema.ts";

function makeEntry(
  overrides: Partial<IEvalHistoryEntry> & { run_id: string; scenario_id: string },
): IEvalHistoryEntry {
  return {
    pack: "subsystem_pack",
    tags: ["subsystem:skills"],
    suite_score: 1,
    passed: true,
    mode: "eval",
    score_threshold: 0.7,
    outcome: "success",
    timestamp: new Date().toISOString(),
    trial_scores: [],
    duration_ms: 10,
    trials: 1,
    component_versions: getDefaultComponentVersions(),
    ...overrides,
  };
}

async function withStore(fn: (store: EvalSqliteStore) => void): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "contract-report-" });
  const store = new EvalSqliteStore(`${dir}/eval.db`);
  try {
    store.initialize();
    fn(store);
  } finally {
    store.close();
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("[report] a summary row reports how many scenarios passed", async () => {
  await withStore((store) => {
    store.writeRun(makeEntry({ run_id: "r1", scenario_id: "s1", suite_score: 1, passed: true }));
    store.writeRun(
      makeEntry({ run_id: "r2", scenario_id: "s2", suite_score: 0, passed: false, outcome: "scenario-failure" }),
    );
    store.writeRun(makeEntry({ run_id: "r3", scenario_id: "s3", suite_score: 1, passed: true }));

    const [row] = store.summarizeByTag("subsystem:", {});

    assertEquals(row.taskCount, 3);
    assertEquals(row.passedCount, 2, "the count is what a contract pack actually reports");
  });
});

Deno.test("[report] an all-binary family is not graded, so its mean carries no information", async () => {
  await withStore((store) => {
    store.writeRun(makeEntry({ run_id: "r1", scenario_id: "s1", suite_score: 1, passed: true }));
    store.writeRun(
      makeEntry({ run_id: "r2", scenario_id: "s2", suite_score: 0, passed: false, outcome: "scenario-failure" }),
    );

    const [row] = store.summarizeByTag("subsystem:", {});

    assertEquals(row.graded, false);
    assertEquals(row.passedCount, 1);
  });
});

Deno.test("[report] a family with a partial score is graded", async () => {
  // A judge-scored cell can be partly good, so the mean is the honest summary there.
  await withStore((store) => {
    store.writeRun(makeEntry({ run_id: "r1", scenario_id: "s1", suite_score: 1, passed: true }));
    store.writeRun(
      makeEntry({ run_id: "r2", scenario_id: "s2", suite_score: 0.62, passed: false, outcome: "scenario-failure" }),
    );

    const [row] = store.summarizeByTag("subsystem:", {});

    assertEquals(row.graded, true);
    assert(row.meanScore > 0.8 && row.meanScore < 0.82, `expected the mean to be reported, got ${row.meanScore}`);
  });
});

Deno.test("[report] a single fully-passing family is still not graded", async () => {
  // The common case, and the one that most invites over-reading: `MEAN 1.000` over 7 yes/no
  // questions is 7/7, not a quality measure.
  await withStore((store) => {
    for (const n of [1, 2, 3]) {
      store.writeRun(makeEntry({ run_id: `r${n}`, scenario_id: `s${n}`, suite_score: 1, passed: true }));
    }

    const [row] = store.summarizeByTag("subsystem:", {});

    assertEquals(row.graded, false);
    assertEquals(row.passedCount, 3);
    assertEquals(row.taskCount, 3);
  });
});

Deno.test("[report] passedCount is exact, not the pass rate rounded back up", async () => {
  // 2 of 3 is 0.667; multiplying back and rounding gives 2 here but is fragile at other sizes.
  await withStore((store) => {
    store.writeRun(makeEntry({ run_id: "r1", scenario_id: "s1", passed: true }));
    for (const n of [2, 3, 4, 5, 6, 7]) {
      store.writeRun(
        makeEntry({
          run_id: `r${n}`,
          scenario_id: `s${n}`,
          suite_score: 0,
          passed: false,
          outcome: "scenario-failure",
        }),
      );
    }

    const [row] = store.summarizeByTag("subsystem:", {});

    assertEquals(row.passedCount, 1);
    assertEquals(row.taskCount, 7);
  });
});

// ---------------------------------------------------------------------------
// Trend deltas. `IFamilySummaryRow.delta` was declared and hardcoded `null`, and the report never
// rendered a column for it — so "shows trend deltas after the second run" could not be true of any
// report. A third dead field in the same file family as `tags` and `graded`.
// ---------------------------------------------------------------------------

Deno.test("[report] a family with only one observation per scenario has no delta", async () => {
  await withStore((store) => {
    store.writeRun(makeEntry({ run_id: "r1", scenario_id: "s1", suite_score: 1, passed: true }));

    const [row] = store.summarizeByTag("subsystem:", {});

    assertEquals(row.delta, null, "there is nothing to compare a first run against");
  });
});

Deno.test("[report] a second observation produces the delta between them", async () => {
  await withStore((store) => {
    // Older first, so the newer one is unambiguous.
    store.writeRun(
      makeEntry({
        run_id: "r1",
        scenario_id: "s1",
        suite_score: 0.5,
        passed: false,
        outcome: "scenario-failure",
        timestamp: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    store.writeRun(makeEntry({ run_id: "r2", scenario_id: "s1", suite_score: 1, passed: true }));

    const [row] = store.summarizeByTag("subsystem:", { lastPerScenario: true });

    assert(row.delta !== null, "a second observation must yield a delta");
    assert(Math.abs(row.delta - 0.5) < 1e-9, `expected +0.5, got ${row.delta}`);
  });
});

Deno.test("[report] a regression shows a negative delta", async () => {
  await withStore((store) => {
    store.writeRun(
      makeEntry({
        run_id: "r1",
        scenario_id: "s1",
        suite_score: 1,
        passed: true,
        timestamp: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    store.writeRun(
      makeEntry({ run_id: "r2", scenario_id: "s1", suite_score: 0.25, passed: false, outcome: "scenario-failure" }),
    );

    const [row] = store.summarizeByTag("subsystem:", { lastPerScenario: true });

    assert(row.delta !== null && row.delta < 0, `a regression must read negative, got ${row.delta}`);
  });
});
