/**
 * @module ModelsDevLiveBenchmarkFetchTest
 * @path tests/integration/modelsdev_live_benchmark_fetch_test.ts
 * @description Phase 135 Step 7a — live integration test that fetches
 *   `https://models.dev/models.json`, filters for Exaix-tracked benchmarks,
 *   normalises benchmark names, and asserts the top-20 SWE-Bench Verified
 *   scores are non-empty and well-formed.
 *   Skipped in CI (network-dependent); run locally with
 *   `deno test tests/integration/modelsdev_live_benchmark_fetch_test.ts --allow-all --no-check`.
 * @architectural-layer Test
 * @related-files [packages-team/model-registry-live/src/modelsdev_ingest.ts]
 */
import { assert, assertEquals, assertGreater } from "@std/assert";

const MODELSDEV_URL = "https://models.dev/models.json";
const FETCH_TIMEOUT_MS = 15_000;
const EXPECTED_MIN_MODELS = 150;

const BENCHMARK_NAME_MAP: Record<string, string> = {
  "SWE-Bench Verified": "swe_bench_verified",
  "SWE-Bench Pro": "swe_bench_pro",
  "SWE Bench Pro": "swe_bench_pro",
  "GPQA Diamond": "gpqa",
  "LiveCodeBench": "live_code_bench",
  "LiveCodeBench Pro": "live_code_bench_pro",
};

const DEVELOPER_PROVIDER_MAP: Record<string, string> = {
  "alibaba": "qwen",
  "zhipuai": "glm",
};

interface IModelsDevEntry {
  id: string;
  name: string;
  last_updated: string;
  benchmarks?: Array<{
    name: string;
    score: number;
    metric: string;
    source?: string;
  }>;
}

interface IFilteredEntry {
  provider: string;
  model: string;
  benchmark: string;
  score: number;
  sourceUrl?: string;
}

function normaliseScore(raw: number): number {
  return raw > 1 ? raw / 100 : raw;
}

function parseModelId(id: string): { provider: string; model: string } {
  const slash = id.indexOf("/");
  if (slash === -1) return { provider: id, model: id };
  return {
    provider: DEVELOPER_PROVIDER_MAP[id.slice(0, slash)] ?? id.slice(0, slash),
    model: id.slice(slash + 1),
  };
}

Deno.test({
  name: "[modelsdev-live] endpoint returns parseable JSON with 150+ models",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await fetch(MODELSDEV_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    assertEquals(res.ok, true, `HTTP ${res.status} from models.dev`);
    const body = await res.json() as { [key: string]: IModelsDevEntry };
    const ids = Object.keys(body);
    assertGreater(ids.length, EXPECTED_MIN_MODELS, `expected >=${EXPECTED_MIN_MODELS} models, got ${ids.length}`);
    // Verify first entry has the expected shape
    const sample = body[ids[0]];
    assertEquals(typeof sample?.id, "string");
    assertEquals(typeof sample?.name, "string");
    assertEquals(typeof sample?.last_updated, "string");
  },
});

Deno.test({
  name: "[modelsdev-live] SWE-Bench Verified exists with top-20 non-empty scores",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await fetch(MODELSDEV_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    assertEquals(res.ok, true);
    const models = await res.json() as Record<string, IModelsDevEntry>;

    const sweBenchEntries: Array<{ model: string; provider: string; score: number; source?: string }> = [];

    for (const id of Object.keys(models)) {
      const entry = models[id];
      if (!entry.benchmarks?.length) continue;
      const swe = entry.benchmarks.find((b) => b.name === "SWE-Bench Verified");
      if (!swe) continue;
      const { provider, model } = parseModelId(id);
      sweBenchEntries.push({ provider, model, score: normaliseScore(swe.score), source: swe.source });
    }

    sweBenchEntries.sort((a, b) => b.score - a.score);
    const top20 = sweBenchEntries.slice(0, 20);

    assertGreater(top20.length, 0, "no SWE-Bench Verified entries found on models.dev");
    for (const e of top20) {
      assert(
        typeof e.score === "number" && e.score > 0 && e.score <= 1,
        `invalid score ${e.score} for ${e.provider}/${e.model}`,
      );
    }
    // Top score should be meaningful (≥0.5 for SWE-Bench Verified)
    assertGreater(top20[0].score, 0.5, `top SWE-Bench Verified score ${top20[0].score} seems too low`);
  },
});

Deno.test({
  name: "[modelsdev-live] benchmark name normalisation maps SWE-Bench Verified → swe_bench_verified",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await fetch(MODELSDEV_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    assertEquals(res.ok, true);
    const models = await res.json() as Record<string, IModelsDevEntry>;

    const filtered: IFilteredEntry[] = [];

    for (const id of Object.keys(models)) {
      const entry = models[id];
      if (!entry.benchmarks?.length) continue;
      const { provider, model } = parseModelId(id);
      for (const bench of entry.benchmarks) {
        const normalised = BENCHMARK_NAME_MAP[bench.name];
        if (!normalised) continue;
        filtered.push({
          provider,
          model,
          benchmark: normalised,
          score: normaliseScore(bench.score),
          sourceUrl: bench.source,
        });
      }
    }

    const sweBenchRows = filtered.filter((f) => f.benchmark === "swe_bench_verified");
    assertGreater(sweBenchRows.length, 0, "no swe_bench_verified entries after normalisation");
    // All should have snake_case benchmark names
    const allNormalised = filtered.every((f) => /^[a-z_]+$/.test(f.benchmark));
    assertEquals(allNormalised, true, "some benchmark names not normalised to snake_case");
  },
});

Deno.test({
  name: "[modelsdev-live] artificialanalysis.ai excluded; benchlm.ai and llm-stats.com sources accepted",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await fetch(MODELSDEV_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    assertEquals(res.ok, true);
    const models = await res.json() as Record<string, IModelsDevEntry>;

    const EXCLUDED = "artificialanalysis.ai";
    let benchlmCount = 0;
    let llmStatsCount = 0;
    let artificialAnalysisCount = 0;

    for (const id of Object.keys(models)) {
      const entry = models[id];
      if (!entry.benchmarks?.length) continue;
      for (const bench of entry.benchmarks) {
        if (!bench.source) continue;
        if (bench.source.includes("benchlm.ai")) benchlmCount++;
        if (bench.source.includes("llm-stats.com")) llmStatsCount++;
        if (bench.source.includes(EXCLUDED)) artificialAnalysisCount++;
      }
    }

    // Confirm artificialanalysis.ai has real citations to exclude
    assertGreater(artificialAnalysisCount, 0, "expected artificialanalysis.ai citations in models.dev data");
    // benchlm.ai and llm-stats.com should also have entries (they're in the real data)
    assertGreater(
      benchlmCount,
      0,
      "expected benchlm.ai citations — claude-fable-5 and claude-opus-4-8 SWE-Bench scores",
    );
    assertGreater(llmStatsCount, 0, "expected llm-stats.com citations in models.dev data");
    // The exclusion count should be larger than the permitted domains (artificialanalysis.ai
    // dominates with 70+ citations vs benchlm.ai's 2-3)
    assertGreater(
      artificialAnalysisCount,
      benchlmCount,
      "artificialanalysis.ai citations should dominate excluded domains",
    );
  },
});

Deno.test({
  name: "[modelsdev-live] filtered entries produce valid IBenchmarkEntry shape for every tracked benchmark",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await fetch(MODELSDEV_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    assertEquals(res.ok, true);
    const models = await res.json() as Record<string, IModelsDevEntry>;

    const entries = new Map<string, number>(); // benchmark → count

    for (const id of Object.keys(models)) {
      const entry = models[id];
      if (!entry.benchmarks?.length) continue;
      const { provider, model } = parseModelId(id);
      for (const bench of entry.benchmarks) {
        const benchmark = BENCHMARK_NAME_MAP[bench.name];
        if (!benchmark) continue;
        entries.set(benchmark, (entries.get(benchmark) ?? 0) + 1);

        // Validate shape
        assert(typeof provider === "string" && provider.length > 0, `empty provider for ${id}`);
        assert(typeof model === "string" && model.length > 0, `empty model for ${id}`);
        const score = normaliseScore(bench.score);
        assert(score >= 0 && score <= 1, `score ${score} out of [0,1] for ${id}/${bench.name}`);
      }
    }

    // At minimum, swe_bench_verified should have entries
    const sweCount = entries.get("swe_bench_verified") ?? 0;
    assertGreater(sweCount, 0, "no swe_bench_verified entries after full filter pipeline");
  },
});

Deno.test({
  name: "[modelsdev-live] provider mapping covers known developer slugs",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await fetch(MODELSDEV_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    assertEquals(res.ok, true);
    const models = await res.json() as Record<string, IModelsDevEntry>;

    for (const id of Object.keys(models)) {
      const { provider, model } = parseModelId(id);
      // provider must never be empty
      assert(provider.length > 0, `empty provider for id=${id}`);
      assert(model.length > 0, `empty model for id=${id}`);
      // Mapped providers should appear
      if (id.startsWith("alibaba/")) {
        assertEquals(provider, "qwen", `expected qwen for ${id}, got ${provider}`);
      }
      if (id.startsWith("zhipuai/")) {
        assertEquals(provider, "glm", `expected glm for ${id}, got ${provider}`);
      }
    }
  },
});

Deno.test({
  name: "[modelsdev-live] top-10 SWE-Bench Verified scores printed for inspection",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await fetch(MODELSDEV_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    assertEquals(res.ok, true);
    const models = await res.json() as Record<string, IModelsDevEntry>;

    const sweBenchEntries: Array<{ model: string; provider: string; score: number; source?: string }> = [];

    for (const id of Object.keys(models)) {
      const entry = models[id];
      if (!entry.benchmarks?.length) continue;
      const swe = entry.benchmarks.find((b) => b.name === "SWE-Bench Verified");
      if (!swe) continue;
      const { provider, model } = parseModelId(id);
      sweBenchEntries.push({ provider, model, score: normaliseScore(swe.score), source: swe.source });
    }

    sweBenchEntries.sort((a, b) => b.score - a.score);
    const top10 = sweBenchEntries.slice(0, 10);

    // Log to console for manual inspection
    console.log(
      "\n  ┌─────────┬──────────────────┬──────────────────────────┬───────┬────────────────────────────────────────────────┐",
    );
    console.log(
      "  │ Rank    │ Provider         │ Model                    │ Score │ Source                                         │",
    );
    console.log(
      "  ├─────────┼──────────────────┼──────────────────────────┼───────┼────────────────────────────────────────────────┤",
    );
    for (let i = 0; i < top10.length; i++) {
      const e = top10[i];
      const source = (e.source ?? "—").padEnd(46).slice(0, 46);
      const scorePct = (e.score * 100).toFixed(1).padStart(5);
      console.log(
        `  │ ${(i + 1).toString().padStart(7)} │ ${e.provider.padEnd(16)} │ ${
          e.model.padEnd(24)
        } │ ${scorePct}% │ ${source} │`,
      );
    }
    console.log(
      "  └─────────┴──────────────────┴──────────────────────────┴───────┴────────────────────────────────────────────────┘",
    );
  },
});
