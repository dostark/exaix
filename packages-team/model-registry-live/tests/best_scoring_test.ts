/**
 * @module BestScoringTest
 * @path packages-team/model-registry-live/tests/best_scoring_test.ts
 * @description Phase 135 Step 8 (F10/F11/G7 + F8) — scoring rigor: the multi-benchmark
 *   curated floor (GAP-A), `best` ranking by task-relevant benchmark with honest
 *   degradation (GAP-C/D), and the opt-in usage tiebreak (F8).
 * @architectural-layer Team-ModelRegistry
 */
import { assertEquals } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { PROVIDER_ANTHROPIC, PROVIDER_OPENAI, TaskType } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import { ModelRegistryService } from "../src/model_registry_service.ts";
import { STATIC_BENCHMARKS } from "../src/static_benchmarks.ts";
import { TeamResolutionStrategy } from "../src/team_resolution_strategy.ts";
import type { ITeamStrategyDeps } from "../src/team_resolution_strategy.ts";

const HEALTHY = { checkProvider: (_p: string) => Promise.resolve(true) };

function svcFor(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  config: Awaited<ReturnType<typeof initTestDbService>>["config"],
) {
  db.instance.exec(REGISTRY_TABLES_SQL);
  const floor = new DefaultModelRegistry(HEALTHY);
  return new ModelRegistryService(db, createMockEventLogger(), config, floor, HEALTHY);
}

const BASE_DEPS: ITeamStrategyDeps = {
  getAdapter: () => undefined,
  buildContext: () => ({ baseUrl: "https://example.test", fetch: globalThis.fetch, timeoutMs: 1000 }),
  isAggregator: () => false,
  routeHealth: () => ({}),
  costExempt: () => false,
  providerCostMetadata: () => undefined,
  routePolicy: "cheapest",
  routePriceTolerance: 0.05,
  routeOrder: {},
};

Deno.test("[step135.8][GAP-A] curated floor seeds swe_bench_pro and gpqa alongside swe_bench_verified", () => {
  const benchmarks = new Set(STATIC_BENCHMARKS.map((e) => e.benchmark));
  assertEquals(benchmarks.has("swe_bench_verified"), true);
  assertEquals(benchmarks.has("swe_bench_pro"), true);
  assertEquals(benchmarks.has("gpqa"), true);
});

Deno.test("[step135.8][GAP-A] getBenchmarkTopN unions leaders across all three tracked benchmarks", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    await svc.applyBenchmarks(STATIC_BENCHMARKS);

    const top = await svc.getBenchmarkTopN(
      ["swe_bench_verified", "swe_bench_pro", "gpqa"],
      25,
    );

    // Every curated model scored on any of the three benchmarks must appear in the union.
    for (const entry of STATIC_BENCHMARKS) {
      assertEquals(top.has(entry.model), true, `expected ${entry.model} in benchmark top-N union`);
    }
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8][GAP-A] getBenchmarkTopN over only swe_bench_verified excludes gpqa/swe_bench_pro-only leaders", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    await svc.applyBenchmarks([
      {
        provider: PROVIDER_ANTHROPIC,
        model: "gpqa-only-model",
        benchmark: "gpqa",
        score: 0.9,
        provenance: "static",
        measuredAt: 1,
      },
      {
        provider: PROVIDER_OPENAI,
        model: "swe-verified-model",
        benchmark: "swe_bench_verified",
        score: 0.8,
        provenance: "static",
        measuredAt: 1,
      },
    ]);

    const top = await svc.getBenchmarkTopN(["swe_bench_verified"], 25);
    assertEquals(top.has("swe-verified-model"), true);
    assertEquals(top.has("gpqa-only-model"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8] scoreBest ranks by benchmark_map[task_type] score desc", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    await svc.applyBenchmarks([
      {
        provider: PROVIDER_ANTHROPIC,
        model: "high",
        benchmark: "swe_bench_verified",
        score: 0.9,
        provenance: "static",
        measuredAt: 1,
      },
      {
        provider: PROVIDER_OPENAI,
        model: "low",
        benchmark: "swe_bench_verified",
        score: 0.3,
        provenance: "static",
        measuredAt: 1,
      },
    ]);
    const strategy = new TeamResolutionStrategy(svc, createMockEventLogger(), {
      ...BASE_DEPS,
      benchmarkMap: { [TaskType.FEATURE]: ["swe_bench_verified"] },
    });

    const scores = await strategy.scoreBest!(
      [{ provider: PROVIDER_ANTHROPIC, model: "high" }, { provider: PROVIDER_OPENAI, model: "low" }],
      TaskType.FEATURE,
    );

    assertEquals(scores[PROVIDER_ANTHROPIC] > scores[PROVIDER_OPENAI], true);
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8][GAP-D] unscored candidate is absent from scores and emits model.benchmark.missing", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    await svc.applyBenchmarks([
      {
        provider: PROVIDER_ANTHROPIC,
        model: "scored",
        benchmark: "swe_bench_verified",
        score: 0.9,
        provenance: "static",
        measuredAt: 1,
      },
    ]);
    const logger = createMockEventLogger();
    const strategy = new TeamResolutionStrategy(svc, logger, {
      ...BASE_DEPS,
      benchmarkMap: { [TaskType.FEATURE]: ["swe_bench_verified"] },
    });

    const scores = await strategy.scoreBest!(
      [{ provider: PROVIDER_ANTHROPIC, model: "scored" }, { provider: PROVIDER_OPENAI, model: "unscored" }],
      TaskType.FEATURE,
    );

    assertEquals(PROVIDER_OPENAI in scores, false);
    const missingEvents = logger.events.filter((e) => e.action === DomainEventType.ModelBenchmarkMissing);
    assertEquals(missingEvents.length, 1);
    assertEquals(missingEvents[0].payload?.provider, PROVIDER_OPENAI);
    assertEquals(missingEvents[0].payload?.model, "unscored");
    assertEquals(missingEvents[0].payload?.task_type, TaskType.FEATURE);
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8][GAP-B] scoreBest tries benchmark_map benchmarks in order — first with a score wins", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    await svc.applyBenchmarks([
      {
        provider: PROVIDER_ANTHROPIC,
        model: "m",
        benchmark: "swe_bench_pro",
        score: 0.5,
        provenance: "static",
        measuredAt: 1,
      },
    ]);
    const strategy = new TeamResolutionStrategy(svc, createMockEventLogger(), {
      ...BASE_DEPS,
      // swe_bench_verified has no score for "m" — falls through to swe_bench_pro.
      benchmarkMap: { [TaskType.REFACTOR]: ["swe_bench_verified", "swe_bench_pro"] },
    });

    const scores = await strategy.scoreBest!([{ provider: PROVIDER_ANTHROPIC, model: "m" }], TaskType.REFACTOR);
    assertEquals(scores[PROVIDER_ANTHROPIC], 0.5);
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8][edge][malformed] every candidate unscored: best falls back without throwing, missing emitted per candidate", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    const logger = createMockEventLogger();
    const strategy = new TeamResolutionStrategy(svc, logger, {
      ...BASE_DEPS,
      benchmarkMap: { [TaskType.FEATURE]: ["swe_bench_verified"] },
    });

    const scores = await strategy.scoreBest!(
      [{ provider: PROVIDER_ANTHROPIC, model: "a" }, { provider: PROVIDER_OPENAI, model: "b" }],
      TaskType.FEATURE,
    );

    assertEquals(Object.keys(scores).length, 0);
    const missingEvents = logger.events.filter((e) => e.action === DomainEventType.ModelBenchmarkMissing);
    assertEquals(missingEvents.length, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8][edge] empty candidate pool for best returns empty scores without throwing", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    const strategy = new TeamResolutionStrategy(svc, createMockEventLogger(), {
      ...BASE_DEPS,
      benchmarkMap: { [TaskType.FEATURE]: ["swe_bench_verified"] },
    });

    const scores = await strategy.scoreBest!([], TaskType.FEATURE);
    assertEquals(scores, {});
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8][F8] getUsageRank orders by MFU then MRU from provider_costs", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    const insert = db.instance.prepare(
      `INSERT INTO provider_costs (id, provider, model, requests, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run("1", PROVIDER_ANTHROPIC, "frequent", 10, "2026-01-01T00:00:00.000Z");
    insert.run("2", PROVIDER_OPENAI, "rare", 1, "2026-01-01T00:00:00.000Z");

    const strategy = new TeamResolutionStrategy(svc, createMockEventLogger(), { ...BASE_DEPS, usageTiebreak: true });
    const ranked = await strategy.rankUsage!(
      [{ provider: PROVIDER_ANTHROPIC, model: "frequent" }, { provider: PROVIDER_OPENAI, model: "rare" }],
    );

    assertEquals(ranked?.[0], PROVIDER_ANTHROPIC);
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8][F8][edge][idempotency] getUsageRank over identical data yields the same order on repeated calls", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    const insert = db.instance.prepare(
      `INSERT INTO provider_costs (id, provider, model, requests, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run("1", PROVIDER_ANTHROPIC, "m", 5, "2026-01-01T00:00:00.000Z");
    insert.run("2", PROVIDER_OPENAI, "m2", 3, "2026-01-01T00:00:00.000Z");

    const strategy = new TeamResolutionStrategy(svc, createMockEventLogger(), { ...BASE_DEPS, usageTiebreak: true });
    const candidates = [{ provider: PROVIDER_ANTHROPIC, model: "m" }, { provider: PROVIDER_OPENAI, model: "m2" }];
    const first = await strategy.rankUsage!(candidates);
    const second = await strategy.rankUsage!(candidates);

    assertEquals(first, second);
  } finally {
    await cleanup();
  }
});

Deno.test("[step135.8][F8] usage_tiebreak=false: rankUsage returns undefined (inert)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    const strategy = new TeamResolutionStrategy(svc, createMockEventLogger(), {
      ...BASE_DEPS,
      usageTiebreak: false,
    });

    const ranked = await strategy.rankUsage!([{ provider: PROVIDER_ANTHROPIC, model: "m" }]);
    assertEquals(ranked, undefined);
  } finally {
    await cleanup();
  }
});
