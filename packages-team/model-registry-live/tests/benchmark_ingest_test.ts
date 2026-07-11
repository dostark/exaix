/**
 * @module BenchmarkIngestTest
 * @path packages-team/model-registry-live/tests/benchmark_ingest_test.ts
 * @description Phase 135 Step 7 (§5.8, F13/G8) — the benchmark data plane. Covers the
 *   model_benchmark table + PK, the curated static floor (idempotent, provenance static),
 *   opt-in EEE ingest (Zod-validated, normalised to 0..1, provenance remote_static,
 *   double-gated), boundary/roundtrip score fidelity + out-of-range rejection, the
 *   tracked-benchmarks-only fetch surface (no instance-level JSONL), malformed-payload
 *   audit with prior scores intact, the default-off double gate, top-N admission of an
 *   otherwise-unadmitted benchmark-top model, and a catalog-refresh regression.
 * @architectural-layer Team-ModelRegistry
 */
import { assertEquals, assertRejects } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { DomainEventType } from "@exaix/core/events";
import type { Config } from "@exaix/schemas";
import type { IDatabaseService } from "@exaix/core/types";
import { ModelRegistryService } from "../src/model_registry_service.ts";
import { STATIC_BENCHMARKS } from "../src/static_benchmarks.ts";
import { ingestBenchmarks } from "../src/benchmark_ingest.ts";
import { admit } from "../src/adapters/admission.ts";
import type { ICatalogEntry } from "@exaix/model-registry";

const HEALTHY = { checkProvider: (_p: string) => Promise.resolve(true) };

function mkService(db: IDatabaseService, config: Config) {
  const floor = new DefaultModelRegistry(HEALTHY);
  const logger = createMockEventLogger();
  const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY);
  return { svc, logger };
}

/** The §5.8 EEE aggregate-result JSON shape the ingest consumes. */
interface IEeeResultFixture {
  schema_version: string;
  model_info: { model_name: string; developer: string };
  evaluation_results: Array<{ benchmark_name: string; aggregate_score: number }>;
}

/** A minimal EEE aggregate-result JSON per the §5.8 interchange schema. */
function eeeResult(model: string, benchmark: string, score: number): IEeeResultFixture {
  return {
    schema_version: "1.0",
    model_info: { model_name: model, developer: "anthropic" },
    evaluation_results: [{ benchmark_name: benchmark, aggregate_score: score }],
  };
}

Deno.test("[step7] migration 004 model_benchmark PK enforces one score per (provider, model, benchmark)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const insert = () =>
      db.instance.prepare(
        `INSERT INTO model_benchmark (provider, model, benchmark, score, provenance, measured_at)
         VALUES ('anthropic', 'claude', 'swe_bench_verified', 0.5, 'static', 1)`,
      ).run();
    insert();
    let threw = false;
    try {
      insert();
    } catch {
      threw = true;
    }
    assertEquals(threw, true); // second insert on the same PK is rejected
  } finally {
    await cleanup();
  }
});

Deno.test("[step7] curated static_benchmarks loads idempotently with provenance static", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc } = mkService(db, config);
    await svc.applyBenchmarks(STATIC_BENCHMARKS);
    const first = db.instance.prepare("SELECT COUNT(*) AS n FROM model_benchmark").get() as { n: number };
    await svc.applyBenchmarks(STATIC_BENCHMARKS); // re-apply
    const second = db.instance.prepare("SELECT COUNT(*) AS n FROM model_benchmark").get() as { n: number };
    assertEquals(first.n, second.n); // idempotent — no duplicate rows
    const row = db.instance.prepare(
      "SELECT provenance FROM model_benchmark LIMIT 1",
    ).get() as { provenance: string };
    assertEquals(row.provenance, "static");
  } finally {
    await cleanup();
  }
});

Deno.test("[step7] EEE aggregate-result JSON validates and normalises to 0..1 with provenance remote_static", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc } = mkService(db, config);
    const fetchStub = (_url: string) =>
      Promise.resolve(new Response(JSON.stringify(eeeResult("gpt-5", "swe_bench_verified", 0.734))));
    const written = await ingestBenchmarks(svc, {
      enabled: true,
      datasetUrl: "https://x.test",
      trackedBenchmarks: ["swe_bench_verified"],
      fetchTimeoutMs: 1000,
      fetch: fetchStub as typeof fetch,
    });
    assertEquals(written, 1);
    const row = db.instance.prepare(
      "SELECT score, provenance FROM model_benchmark WHERE model = 'gpt-5'",
    ).get() as { score: number; provenance: string };
    assertEquals(row.score, 0.734);
    assertEquals(row.provenance, "remote_static");
  } finally {
    await cleanup();
  }
});

Deno.test("[step7][edge][roundtrip] boundary scores survive write→read; out-of-range is rejected not stored raw", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc } = mkService(db, config);
    for (const [model, score] of [["a", 0], ["b", 1], ["c", 0.42]] as const) {
      await svc.applyBenchmarks([{
        provider: "p",
        model,
        benchmark: "swe_bench_verified",
        score,
        provenance: "static",
        measuredAt: 1,
      }]);
      assertEquals(await svc.getBenchmark("p", model, "swe_bench_verified"), score);
    }
    // >1 and <0 are invalid input — rejected, not clamped-and-stored-raw.
    await assertRejects(() =>
      svc.applyBenchmarks([{
        provider: "p",
        model: "bad",
        benchmark: "swe_bench_verified",
        score: 1.5,
        provenance: "static",
        measuredAt: 1,
      }])
    );
    assertEquals(await svc.getBenchmark("p", "bad", "swe_bench_verified"), undefined);
  } finally {
    await cleanup();
  }
});

Deno.test("[step7] only tracked_benchmarks paths fetched; instance-level JSONL never requested", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc } = mkService(db, config);
    const requested: string[] = [];
    const fetchStub = (url: string) => {
      requested.push(url);
      return Promise.resolve(new Response(JSON.stringify(eeeResult("m", "swe_bench_verified", 0.5))));
    };
    await ingestBenchmarks(svc, {
      enabled: true,
      datasetUrl: "https://x.test",
      trackedBenchmarks: ["swe_bench_verified"],
      fetchTimeoutMs: 1000,
      fetch: fetchStub as typeof fetch,
    });
    assertEquals(requested.every((u) => u.includes("swe_bench_verified")), true);
    // No instance-level per-run JSONL path is ever requested.
    assertEquals(requested.some((u) => u.endsWith(".jsonl")), false);
  } finally {
    await cleanup();
  }
});

Deno.test("[step7] malformed EEE payload → parse_error audit, previous scores intact", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc, logger } = mkService(db, config);
    await svc.applyBenchmarks([{
      provider: "p",
      model: "keep",
      benchmark: "swe_bench_verified",
      score: 0.6,
      provenance: "static",
      measuredAt: 1,
    }]);
    const fetchStub = (_url: string) => Promise.resolve(new Response("{not json"));
    await ingestBenchmarks(svc, {
      enabled: true,
      datasetUrl: "https://x.test",
      trackedBenchmarks: ["swe_bench_verified"],
      fetchTimeoutMs: 1000,
      fetch: fetchStub as typeof fetch,
    });
    // Previous curated score is untouched.
    assertEquals(await svc.getBenchmark("p", "keep", "swe_bench_verified"), 0.6);
    const failed = logger.events.filter((e) =>
      e.action === DomainEventType.ModelBenchmarkRefreshed && e.payload?.outcome === "parse_error"
    );
    assertEquals(failed.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[step7] double gate: benchmark_source.enabled=false (default) fetches nothing", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc } = mkService(db, config);
    let fetched = 0;
    const fetchStub = (_url: string) => {
      fetched++;
      return Promise.resolve(new Response("{}"));
    };
    const written = await ingestBenchmarks(svc, {
      enabled: false, // gate closed
      datasetUrl: "https://x.test",
      trackedBenchmarks: ["swe_bench_verified"],
      fetchTimeoutMs: 1000,
      fetch: fetchStub as typeof fetch,
    });
    assertEquals(fetched, 0);
    assertEquals(written, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("[step7] admission top_n admits a benchmark-top model not otherwise curated/native", () => {
  const entries: ICatalogEntry[] = [
    { model: "aggregator-only-top", contextWindow: 1000 },
    { model: "aggregator-only-low", contextWindow: 1000 },
  ];
  // An aggregator (not native), the model is not curated/used — only the top-N set admits it.
  const admitted = admit(entries, {
    curatedModels: new Set(),
    usedModels: new Set(),
    isAggregator: true,
    keepNativeWhole: true,
    topN: 25,
    benchmarkTopN: new Set(["aggregator-only-top"]),
  });
  assertEquals(admitted.length, 1);
  assertEquals(admitted[0].entry.model, "aggregator-only-top");
  assertEquals(admitted[0].reason, "benchmark_topn");
});

Deno.test("[step7][regression] catalog refresh passes unaffected by the benchmark table", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc } = mkService(db, config);
    const diff = await svc.applyRefresh(
      "anthropic",
      [{ model: "claude-x", contextWindow: 200_000 }],
      {
        curatedModels: new Set(["claude-x"]),
        usedModels: new Set(),
        isAggregator: false,
        keepNativeWhole: true,
        topN: 25,
        benchmarkTopN: new Set(),
      },
    );
    assertEquals(diff.added, 1);
    const models = await svc.getProviderModels("anthropic");
    assertEquals(models.length, 1);
  } finally {
    await cleanup();
  }
});
