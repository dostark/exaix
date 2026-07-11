/**
 * @module BenchmarkIngest
 * @path packages-team/model-registry-live/src/benchmark_ingest.ts
 * @description Phase 135 Step 7 (§5.8, F13/G8) — the opt-in EEE benchmark ingest. For
 *   each tracked benchmark, anonymously fetch the coalition-owned aggregate-result JSON,
 *   Zod-validate the interchange schema (schema_version, model_info, evaluation_results),
 *   normalise scores to [0,1], and upsert with provenance "remote_static". Doubly gated:
 *   the caller only reaches here when model_registry.enabled, and this returns early when
 *   benchmark_source.enabled is false (zero outbound calls, the default). Only
 *   tracked-benchmark aggregate paths are fetched — instance-level JSONL is never
 *   requested (§5.8.1 governance). A malformed/failed source records a parse_error /
 *   http_error benchmark-refreshed event and leaves previously-stored scores intact.
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix-team/model-registry-live, zod]
 * @related-files [packages-team/model-registry-live/src/model_registry_service.ts, packages/schemas/src/config.ts]
 */
import { z } from "zod";
import type { IBenchmarkEntry, ModelRegistryService } from "./model_registry_service.ts";

/** Options threaded from benchmark_source config for one ingest run. */
export interface IBenchmarkIngestOptions {
  enabled: boolean;
  datasetUrl: string;
  trackedBenchmarks: string[];
  fetchTimeoutMs: number;
  fetch: typeof fetch;
}

const SCORE_MIN = 0;
const SCORE_MAX = 1;
/** Scores published as a 0..100 percentage are divided by this to normalise to [0,1]. */
const PERCENT_DIVISOR = 100;

/** The §5.8 EEE aggregate-result interchange schema (only the fields we consume). */
const EeeResultSchema = z.object({
  schema_version: z.string(),
  model_info: z.object({
    model_name: z.string(),
    developer: z.string(),
  }),
  evaluation_results: z.array(z.object({
    benchmark_name: z.string(),
    aggregate_score: z.number(),
  })),
});

type EeeResult = z.infer<typeof EeeResultSchema>;

/** Normalise a raw aggregate score to [0,1]: values >1 are treated as a percentage. */
function normalise(raw: number): number {
  const v = raw > SCORE_MAX ? raw / PERCENT_DIVISOR : raw;
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, v));
}

/** Build the aggregate-result URL for one tracked benchmark (never an instance JSONL). */
function benchmarkUrl(datasetUrl: string, benchmark: string): string {
  const base = datasetUrl.endsWith("/") ? datasetUrl : `${datasetUrl}/`;
  return `${base}${benchmark}/aggregate.json`;
}

/** Map an EEE result to benchmark rows keyed on the developer as provider. */
function toEntries(result: EeeResult, now: number): IBenchmarkEntry[] {
  return result.evaluation_results.map((r) => ({
    provider: result.model_info.developer,
    model: result.model_info.model_name,
    benchmark: r.benchmark_name,
    score: normalise(r.aggregate_score),
    provenance: "remote_static" as const,
    measuredAt: now,
  }));
}

/**
 * Run one ingest pass. Returns the number of scores written. A closed gate
 * (`enabled === false`) short-circuits with zero fetches. Each tracked benchmark is
 * fetched, validated, and upserted independently: one bad source records a failure event
 * without aborting the others or disturbing prior scores.
 */
export async function ingestBenchmarks(
  service: ModelRegistryService,
  opts: IBenchmarkIngestOptions,
): Promise<number> {
  if (!opts.enabled) return 0; // double gate: benchmark_source.enabled === false
  let written = 0;
  for (const benchmark of opts.trackedBenchmarks) {
    try {
      const res = await opts.fetch(benchmarkUrl(opts.datasetUrl, benchmark), {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(opts.fetchTimeoutMs),
      });
      if (!res.ok) {
        await service.emitBenchmarkRefreshed(benchmark, 0, "http_error");
        continue;
      }
      const body = await res.json();
      const parsed = EeeResultSchema.safeParse(body);
      if (!parsed.success) {
        await service.emitBenchmarkRefreshed(benchmark, 0, "parse_error");
        continue;
      }
      const entries = toEntries(parsed.data, Date.now());
      const n = await service.applyBenchmarks(entries);
      written += n;
      await service.emitBenchmarkRefreshed(benchmark, n, "success");
    } catch {
      // Network / JSON parse failure — previous scores stay intact (§7.2 posture).
      await service.emitBenchmarkRefreshed(benchmark, 0, "parse_error");
    }
  }
  return written;
}
