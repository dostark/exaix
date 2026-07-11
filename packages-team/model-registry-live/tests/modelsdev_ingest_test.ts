/**
 * @module ModelsDevIngestTest
 * @path packages-team/model-registry-live/tests/modelsdev_ingest_test.ts
 * @description Phase 135 Step 7a — models.dev automated benchmark feed. Covers the
 *   JSON fetch → filter tracked benchmarks → map model IDs → upsert shape, leaderboard-
 *   product source exclusion, benchmark name normalisation, developer→provider mapping,
 *   graceful no-op on unreachable / malformed remote, and the no-tracked-matches case.
 * @architectural-layer Team-ModelRegistry
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { DomainEventType } from "@exaix/core/events";
import type { Config } from "@exaix/schemas";
import type { IDatabaseService } from "@exaix/core/types";
import { ModelRegistryService } from "../src/model_registry_service.ts";
import { fetchModelsDevBenchmarks } from "../src/modelsdev_ingest.ts";

const HEALTHY = { checkProvider: (_p: string) => Promise.resolve(true) };

/** Extract scores_written from a ModelBenchmarkRefreshed event payload. */
/** A single entry in the models.dev fixture body. */
interface IModelsDevFixtureEntry {
  id: string;
  name: string;
  last_updated: string;
  benchmarks: Array<{ name: string; score: number; metric: string; source?: string }>;
}

/** Narrow payload shape for scores_written extraction. */
type MockPayload = { scores_written?: number };

function scoresWritten(event: { payload?: MockPayload }): number {
  const v = event.payload?.scores_written;
  return typeof v === "number" ? v : -1;
}

function mkService(db: IDatabaseService, config: Config) {
  const floor = new DefaultModelRegistry(HEALTHY);
  const logger = createMockEventLogger();
  const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY);
  return { svc, logger };
}

/** Build a models.dev-style JSON body from an array of model entries. */
function modelsDevBody(
  models: Array<{
    id: string;
    name: string;
    last_updated?: string;
    benchmarks: Array<{ name: string; score: number; metric?: string; source?: string }>;
  }>,
): Record<string, IModelsDevFixtureEntry> {
  const body: Record<string, IModelsDevFixtureEntry> = {};
  for (const m of models) {
    body[m.id] = {
      id: m.id,
      name: m.name,
      last_updated: m.last_updated ?? "2026-07-01",
      benchmarks: m.benchmarks.map((b) => ({
        name: b.name,
        score: b.score,
        metric: b.metric ?? "pass@1",
        ...(b.source ? { source: b.source } : {}),
      })),
    };
  }
  return body;
}

Deno.test("[step7a] models.dev JSON fetch produces valid IBenchmarkEntry[] for tracked benchmarks", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc, logger } = mkService(db, config);
    const body = modelsDevBody([
      {
        id: "anthropic/claude-opus-4-8",
        name: "Claude Opus 4.8",
        benchmarks: [
          { name: "SWE-Bench Verified", score: 88.6, source: "https://anthropic.com/news/claude-opus-4-8" },
        ],
      },
    ]);
    const fetchStub = () => Promise.resolve(new Response(JSON.stringify(body)));
    const written = await fetchModelsDevBenchmarks(svc, {
      endpoint: "https://models.dev/models.json",
      trackedBenchmarks: ["swe_bench_verified"],
      fetchTimeoutMs: 1000,
      fetch: fetchStub as typeof fetch,
    });
    assertEquals(written, 1);
    const row = db.instance.prepare(
      "SELECT provider, model, benchmark, score, provenance, source_url FROM model_benchmark",
    ).get() as {
      provider: string;
      model: string;
      benchmark: string;
      score: number;
      provenance: string;
      source_url: string | null;
    };
    assertEquals(row.provider, "anthropic");
    assertEquals(row.model, "claude-opus-4-8");
    assertEquals(row.benchmark, "swe_bench_verified");
    assertAlmostEquals(row.score, 0.886, 1e-6); // normalised from 88.6
    assertEquals(row.provenance, "remote_static");
    assertEquals(row.source_url, "https://anthropic.com/news/claude-opus-4-8");
    // success event emitted
    const success = logger.events.filter((e) =>
      e.action === DomainEventType.ModelBenchmarkRefreshed && e.payload?.outcome === "success"
    );
    assertEquals(success.length, 1);
    assertEquals(scoresWritten(success[0]), 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[step7a] benchlm.ai and llm-stats.com sources accepted; artificialanalysis.ai excluded", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc } = mkService(db, config);
    const body = modelsDevBody([
      {
        id: "anthropic/claude-fable-5",
        name: "Claude Fable 5",
        benchmarks: [
          { name: "SWE-Bench Verified", score: 95, source: "https://benchlm.ai/benchmarks/sweVerified" },
          { name: "SWE-Bench Verified", score: 94, source: "https://artificialanalysis.ai/agents/coding-agents" },
        ],
      },
      {
        id: "microsoft/mai-code-1-flash",
        name: "MAI Code 1 Flash",
        benchmarks: [
          { name: "SWE-Bench Verified", score: 72, source: "https://llm-stats.com/benchmarks/swe-bench-verified" },
        ],
      },
    ]);
    const fetchStub = () => Promise.resolve(new Response(JSON.stringify(body)));
    const written = await fetchModelsDevBenchmarks(svc, {
      endpoint: "https://models.dev/models.json",
      trackedBenchmarks: ["swe_bench_verified"],
      fetchTimeoutMs: 1000,
      fetch: fetchStub as typeof fetch,
    });
    assertEquals(written, 2); // benchlm.ai accepted, llm-stats.com accepted, artificialanalysis.ai excluded
    const rows = db.instance.prepare(
      "SELECT model, score, source_url FROM model_benchmark ORDER BY model",
    ).all() as Array<{ model: string; score: number; source_url: string }>;
    assertEquals(rows.length, 2);
    assertEquals(rows[0].model, "claude-fable-5");
    assertEquals(rows[0].source_url, "https://benchlm.ai/benchmarks/sweVerified");
    assertEquals(rows[0].score, 0.95);
    assertEquals(rows[1].model, "mai-code-1-flash");
    assertEquals(rows[1].source_url, "https://llm-stats.com/benchmarks/swe-bench-verified");
    assertEquals(rows[1].score, 0.72);
  } finally {
    await cleanup();
  }
});

Deno.test("[step7a] benchmark name normalised to Exaix snake_case", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc } = mkService(db, config);
    const body = modelsDevBody([
      {
        id: "anthropic/claude-sonnet-5",
        name: "Claude Sonnet 5",
        benchmarks: [
          { name: "SWE-Bench Verified", score: 85.2, source: "https://anthropic.com" },
          { name: "GPQA Diamond", score: 79.1, source: "https://anthropic.com" },
        ],
      },
    ]);
    const fetchStub = () => Promise.resolve(new Response(JSON.stringify(body)));
    const written = await fetchModelsDevBenchmarks(svc, {
      endpoint: "https://models.dev/models.json",
      trackedBenchmarks: ["swe_bench_verified", "gpqa"],
      fetchTimeoutMs: 1000,
      fetch: fetchStub as typeof fetch,
    });
    assertEquals(written, 2);
    const rows = db.instance.prepare(
      "SELECT benchmark, score FROM model_benchmark WHERE model = 'claude-sonnet-5' ORDER BY benchmark",
    ).all() as Array<{ benchmark: string; score: number }>;
    assertEquals(rows.length, 2);
    assertEquals(rows[0].benchmark, "gpqa");
    assertAlmostEquals(rows[0].score, 0.791, 1e-6);
    assertEquals(rows[1].benchmark, "swe_bench_verified");
    assertAlmostEquals(rows[1].score, 0.852, 1e-6);
  } finally {
    await cleanup();
  }
});

Deno.test("[step7a] developer mapping: alibaba → qwen, zhipuai → glm", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc } = mkService(db, config);
    const body = modelsDevBody([
      {
        id: "alibaba/qwen-2.5-max",
        name: "Qwen 2.5 Max",
        benchmarks: [
          { name: "SWE-Bench Verified", score: 50, source: "https://qwen.alibaba.com" },
        ],
      },
      {
        id: "zhipuai/glm-4",
        name: "GLM-4",
        benchmarks: [
          { name: "SWE-Bench Verified", score: 45, source: "https://zhipuai.cn" },
        ],
      },
    ]);
    const fetchStub = () => Promise.resolve(new Response(JSON.stringify(body)));
    const written = await fetchModelsDevBenchmarks(svc, {
      endpoint: "https://models.dev/models.json",
      trackedBenchmarks: ["swe_bench_verified"],
      fetchTimeoutMs: 1000,
      fetch: fetchStub as typeof fetch,
    });
    assertEquals(written, 2);
    const rows = db.instance.prepare(
      "SELECT provider, model FROM model_benchmark ORDER BY provider",
    ).all() as Array<{ provider: string; model: string }>;
    assertEquals(rows.length, 2);
    assertEquals(rows[0].provider, "glm");
    assertEquals(rows[0].model, "glm-4");
    assertEquals(rows[1].provider, "qwen");
    assertEquals(rows[1].model, "qwen-2.5-max");
  } finally {
    await cleanup();
  }
});

Deno.test("[step7a][edge] models.dev endpoint unreachable → graceful no-op, previous scores intact", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc, logger } = mkService(db, config);
    // Pre-populate with a static entry
    await svc.applyBenchmarks([{
      provider: "p",
      model: "keep",
      benchmark: "swe_bench_verified",
      score: 0.6,
      provenance: "static",
      measuredAt: 1,
    }]);
    // fetch stub throws (network unreachable)
    const fetchStub = () => Promise.reject(new Error("network error"));
    const written = await fetchModelsDevBenchmarks(svc, {
      endpoint: "https://models.dev/models.json",
      trackedBenchmarks: ["swe_bench_verified"],
      fetchTimeoutMs: 500,
      fetch: fetchStub as typeof fetch,
    });
    assertEquals(written, 0);
    // Previous curated score is untouched
    assertEquals(await svc.getBenchmark("p", "keep", "swe_bench_verified"), 0.6);
    const failed = logger.events.filter((e) =>
      e.action === DomainEventType.ModelBenchmarkRefreshed && e.payload?.outcome === "http_error"
    );
    assertEquals(failed.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[step7a][edge] malformed JSON from models.dev → graceful no-op, log event", async () => {
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
    const fetchStub = () => Promise.resolve(new Response("{not json"));
    const written = await fetchModelsDevBenchmarks(svc, {
      endpoint: "https://models.dev/models.json",
      trackedBenchmarks: ["swe_bench_verified"],
      fetchTimeoutMs: 1000,
      fetch: fetchStub as typeof fetch,
    });
    assertEquals(written, 0);
    assertEquals(await svc.getBenchmark("p", "keep", "swe_bench_verified"), 0.6);
    const failed = logger.events.filter((e) =>
      e.action === DomainEventType.ModelBenchmarkRefreshed && e.payload?.outcome === "parse_error"
    );
    assertEquals(failed.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[step7a][edge] no tracked benchmark matches → 0 written, success event", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc, logger } = mkService(db, config);
    const body = modelsDevBody([
      {
        id: "anthropic/claude-opus-4-8",
        name: "Claude Opus 4.8",
        benchmarks: [
          { name: "SWE-Bench Verified", score: 88.6, source: "https://anthropic.com" },
        ],
      },
    ]);
    const fetchStub = () => Promise.resolve(new Response(JSON.stringify(body)));
    // Track only a benchmark that models.dev doesn't have
    const written = await fetchModelsDevBenchmarks(svc, {
      endpoint: "https://models.dev/models.json",
      trackedBenchmarks: ["nonexistent_benchmark"],
      fetchTimeoutMs: 1000,
      fetch: fetchStub as typeof fetch,
    });
    assertEquals(written, 0);
    const success = logger.events.filter((e) =>
      e.action === DomainEventType.ModelBenchmarkRefreshed && e.payload?.outcome === "success"
    );
    assertEquals(success.length, 1);
    assertEquals(scoresWritten(success[0]), 0);
  } finally {
    await cleanup();
  }
});

Deno.test("[step7a][edge] HTTP error status → graceful no-op, http_error event", async () => {
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
    const fetchStub = () => Promise.resolve(new Response("Internal Server Error", { status: 500 }));
    const written = await fetchModelsDevBenchmarks(svc, {
      endpoint: "https://models.dev/models.json",
      trackedBenchmarks: ["swe_bench_verified"],
      fetchTimeoutMs: 1000,
      fetch: fetchStub as typeof fetch,
    });
    assertEquals(written, 0);
    assertEquals(await svc.getBenchmark("p", "keep", "swe_bench_verified"), 0.6);
    const failed = logger.events.filter((e) =>
      e.action === DomainEventType.ModelBenchmarkRefreshed && e.payload?.outcome === "http_error"
    );
    assertEquals(failed.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[step7a][edge] models without benchmarks array are skipped gracefully", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc } = mkService(db, config);
    const body = {
      "anthropic/claude-opus-4-8": {
        id: "anthropic/claude-opus-4-8",
        name: "Claude Opus 4.8",
        last_updated: "2026-07-01",
      },
    };
    const fetchStub = () => Promise.resolve(new Response(JSON.stringify(body)));
    const written = await fetchModelsDevBenchmarks(svc, {
      endpoint: "https://models.dev/models.json",
      trackedBenchmarks: ["swe_bench_verified"],
      fetchTimeoutMs: 1000,
      fetch: fetchStub as typeof fetch,
    });
    assertEquals(written, 0);
    const count = db.instance.prepare("SELECT COUNT(*) AS n FROM model_benchmark").get() as { n: number };
    assertEquals(count.n, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("[step7a][regression] applyBenchmarks out-of-range rejection still applies", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const { svc } = mkService(db, config);
    // Score > 1 is not-normalised in the DB — normaliseScore ensures it's [0,1]
    const body = modelsDevBody([
      {
        id: "x/y",
        name: "Y",
        benchmarks: [
          { name: "SWE-Bench Verified", score: 1.5, source: "https://example.com" },
        ],
      },
    ]);
    // 1.5 > 1 so normaliseScore divides by 100 → 0.015, which is in [0,1]
    const fetchStub = () => Promise.resolve(new Response(JSON.stringify(body)));
    const written = await fetchModelsDevBenchmarks(svc, {
      endpoint: "https://models.dev/models.json",
      trackedBenchmarks: ["swe_bench_verified"],
      fetchTimeoutMs: 1000,
      fetch: fetchStub as typeof fetch,
    });
    assertEquals(written, 1);
    const row = db.instance.prepare(
      "SELECT score FROM model_benchmark",
    ).get() as { score: number };
    assertAlmostEquals(row.score, 0.015, 1e-6);
  } finally {
    await cleanup();
  }
});
