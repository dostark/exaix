/**
 * @module ModelsDevIngest
 * @path packages-team/model-registry-live/src/modelsdev_ingest.ts
 * @description Phase 135 Step 7a — models.dev automated benchmark feed. Fetches
 *   `https://models.dev/models.json` (single JSON dict of 245+ models with benchmarks[]),
 *   filters for tracked benchmarks, normalises benchmark names to Exaix snake_case,
 *   maps developer slugs to Exaix provider names, and upserts with provenance
 *   "remote_static". A network / HTTP / parse failure emits a http_error / parse_error
 *   benchmark-refreshed event and leaves prior scores intact.
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix-team/model-registry-live]
 * @related-files [packages-team/model-registry-live/src/model_registry_service.ts, packages/schemas/src/config.ts]
 */
import type { IBenchmarkEntry, ModelRegistryService } from "./model_registry_service.ts";
import type { Opt, Reason } from "@exaix/core/types";

/** Options for a models.dev ingest run, threaded from benchmark_source config. */
export interface IModelsDevIngestOptions {
  endpoint: string;
  trackedBenchmarks: string[];
  fetchTimeoutMs: number;
  fetch: typeof fetch;
}

/** Map of models.dev developer slugs to Exaix provider names. */
const DEVELOPER_PROVIDER_MAP: Record<string, string> = {
  "alibaba": "qwen",
  "zhipuai": "glm",
};

/** Domains excluded from ingestion: only artificialanalysis.ai (its citations are mostly non-tracked
 * benchmarks). benchlm.ai/llm-stats.com stay permitted since they include otherwise-lost top
 * SWE-Bench Verified scores despite citing few models. */
const EXCLUDED_SOURCE_DOMAINS = [
  "artificialanalysis.ai",
];

/** Benchmark name normalisation: models.dev human-readable → Exaix snake_case; maps only tracked benchmarks (§5.8). */
const BENCHMARK_NAME_MAP: Record<string, string> = {
  "SWE-Bench Verified": "swe_bench_verified",
  "SWE-Bench Pro": "swe_bench_pro",
  "SWE Bench Pro": "swe_bench_pro",
  "GPQA Diamond": "gpqa",
  "LiveCodeBench": "live_code_bench",
  "LiveCodeBench Pro": "live_code_bench_pro",
};

/** A single model entry from models.dev's JSON response. */
interface IModelsDevModelEntry {
  id: string;
  name: string;
  last_updated: string;
  benchmarks: Array<{
    name: string;
    score: number;
    metric: string;
    source?: string;
  }>;
}

/** Options for a models.dev ingest run, threaded from benchmark_source config. */
const SCORE_MIN = 0;
const SCORE_MAX = 1;
const PERCENT_DIVISOR = 100;
const REFRESH_OUTCOME_SUCCESS = "success";
const REFRESH_OUTCOME_HTTP_ERROR = "http_error";
const REFRESH_OUTCOME_PARSE_ERROR = "parse_error";

/** Normalise a raw models.dev score to [0,1]: values >1 are treated as a percentage. */
function normaliseScore(raw: number): number {
  const v = raw > SCORE_MAX ? raw / PERCENT_DIVISOR : raw;
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, v));
}

/** Check whether a source URL comes from an excluded domain. */
function isExcludedSource(sourceUrl: Opt<string, Reason.OptionalContext>): boolean {
  if (!sourceUrl) return false;
  try {
    const url = new URL(sourceUrl);
    return EXCLUDED_SOURCE_DOMAINS.some((d) => url.hostname.includes(d));
  } catch {
    return false;
  }
}

/** Parses a models.dev ID (`{developer}/{model_name}`); unmapped developer slugs pass through as-is. */
function parseModelId(id: string): { provider: string; model: string } {
  const slash = id.indexOf("/");
  if (slash === -1) return { provider: id, model: id };
  return {
    provider: DEVELOPER_PROVIDER_MAP[id.slice(0, slash)] ?? id.slice(0, slash),
    model: id.slice(slash + 1),
  };
}

/** Normalises a models.dev benchmark name to Exaix snake_case; returns undefined if untracked. */
function normaliseBenchmarkName(name: string): string | undefined {
  return BENCHMARK_NAME_MAP[name];
}

/**
 * Fetches models.dev/models.json and upserts tracked-benchmark scores via applyBenchmarks().
 * On network/HTTP/parse failure, emits a benchmark-refreshed event and returns 0 without
 * touching prior scores.
 */
export async function fetchModelsDevBenchmarks(
  service: ModelRegistryService,
  opts: IModelsDevIngestOptions,
): Promise<number> {
  let response: Response;
  try {
    response = await opts.fetch(opts.endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(opts.fetchTimeoutMs),
    });
    if (!response.ok) {
      await service.emitBenchmarkRefreshed("models.dev", 0, REFRESH_OUTCOME_HTTP_ERROR);
      return 0;
    }
  } catch {
    await service.emitBenchmarkRefreshed("models.dev", 0, REFRESH_OUTCOME_HTTP_ERROR);
    return 0;
  }

  let models: Record<string, IModelsDevModelEntry>;
  try {
    models = await response.json();
  } catch {
    await service.emitBenchmarkRefreshed("models.dev", 0, REFRESH_OUTCOME_PARSE_ERROR);
    return 0;
  }

  const entries: IBenchmarkEntry[] = [];
  const now = Date.now();

  for (const modelId of Object.keys(models)) {
    const modelData = models[modelId];
    if (!modelData.benchmarks?.length) continue;

    const { provider, model } = parseModelId(modelId);
    if (!model) continue;

    for (const bench of modelData.benchmarks) {
      const benchmark = normaliseBenchmarkName(bench.name);
      if (!benchmark) continue;
      if (!opts.trackedBenchmarks.includes(benchmark)) continue;
      if (isExcludedSource(bench.source)) continue;

      entries.push({
        provider,
        model,
        benchmark,
        score: normaliseScore(bench.score),
        provenance: "remote_static",
        measuredAt: now,
        sourceUrl: bench.source,
      });
    }
  }

  if (entries.length === 0) {
    await service.emitBenchmarkRefreshed("models.dev", 0, REFRESH_OUTCOME_SUCCESS);
    return 0;
  }

  try {
    const count = await service.applyBenchmarks(entries);
    await service.emitBenchmarkRefreshed("models.dev", count, REFRESH_OUTCOME_SUCCESS);
    return count;
  } catch {
    await service.emitBenchmarkRefreshed("models.dev", 0, REFRESH_OUTCOME_PARSE_ERROR);
    return 0;
  }
}
