/**
 * @module BenchmarkIngest
 * @path packages-team/model-registry-live/src/benchmark_ingest.ts
 * @description Phase 135 Step 7 (§5.8, F13/G8) — the opt-in EEE benchmark ingest. For each
 *   tracked benchmark, enumerate the coalition-owned EEE_datastore subtree
 *   (`{benchmark}/{developer}/{model}/{uuid}.json`, §5.8.6) via an injected tree lister,
 *   then anonymously fetch each per-result JSON, Zod-validate the interchange schema
 *   (schema_version, model_info, evaluation_results), normalise scores to [0,1], and upsert
 *   with provenance "remote_static". Doubly gated: the caller only reaches here when
 *   model_registry.enabled, and this returns early when benchmark_source.enabled is false
 *   (zero listing/fetch, the default). Only the tracked-benchmark tree is walked —
 *   instance-level JSONL is never requested (§5.8.1 governance). A malformed/failed source
 *   records a parse_error/http_error benchmark-refreshed event and leaves prior scores
 *   intact. No live tree lister ships (G8 data-license unresolved); the default enumerates
 *   nothing, so with the flag off the ingest is fully inert.
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
  /**
   * Enumerate the per-result entry paths under one benchmark's subtree, each of the form
   * `{benchmark}/{developer}/{model}/{uuid}.json` (§5.8.6). This is the EEE_datastore tree
   * listing (HF datasets tree API). Injected so the walk is testable without the live
   * datastore; a default that returns `[]` keeps the ingest an inert no-op until a real
   * lister is wired (the G8 data-license gate governs whether one ever is).
   */
  listTree?: (benchmark: string) => Promise<string[]>;
}

const SCORE_MIN = 0;
const SCORE_MAX = 1;
/** Scores published as a 0..100 percentage are divided by this to normalise to [0,1]. */
const PERCENT_DIVISOR = 100;
/** No live EEE tree lister is wired yet (G8) — the default enumerates nothing. */
const emptyTreeListing = (_benchmark: string): Promise<string[]> => Promise.resolve([]);

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

/** Absolute URL for one tree entry path under the dataset root (never an instance JSONL). */
function entryUrl(datasetUrl: string, entryPath: string): string {
  const base = datasetUrl.endsWith("/") ? datasetUrl : `${datasetUrl}/`;
  return `${base}${entryPath}`;
}

/** Map an EEE per-result JSON to benchmark rows keyed on the developer as provider. */
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
 * Ingest one tree entry (`{benchmark}/{developer}/{model}/{uuid}.json`): fetch, Zod-validate
 * the interchange schema, upsert. Returns the number of scores written; throws on
 * fetch/HTTP/parse failure so the caller records a single per-benchmark failure event.
 */
async function ingestEntry(
  service: ModelRegistryService,
  opts: IBenchmarkIngestOptions,
  entryPath: string,
): Promise<number> {
  const res = await opts.fetch(entryUrl(opts.datasetUrl, entryPath), {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(opts.fetchTimeoutMs),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const parsed = EeeResultSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error("schema mismatch");
  return service.applyBenchmarks(toEntries(parsed.data, Date.now()));
}

/**
 * Run one ingest pass over the EEE_datastore tree (§5.8.6). Returns the number of scores
 * written. A closed gate (`enabled === false`) short-circuits without listing or fetching.
 * For each tracked benchmark: enumerate its `{developer}/{model}/{uuid}.json` subtree, then
 * fetch/validate/upsert each per-result JSON. A benchmark whose listing or any entry fails
 * records one parse_error/http_error event and leaves prior scores intact — one bad
 * benchmark never aborts the others (§7.2 posture).
 */
export async function ingestBenchmarks(
  service: ModelRegistryService,
  opts: IBenchmarkIngestOptions,
): Promise<number> {
  if (!opts.enabled) return 0; // double gate: benchmark_source.enabled === false
  const listTree = opts.listTree ?? emptyTreeListing;
  let written = 0;
  for (const benchmark of opts.trackedBenchmarks) {
    try {
      const entryPaths = await listTree(benchmark);
      let benchmarkWritten = 0;
      for (const entryPath of entryPaths) {
        benchmarkWritten += await ingestEntry(service, opts, entryPath);
      }
      written += benchmarkWritten;
      await service.emitBenchmarkRefreshed(benchmark, benchmarkWritten, "success");
    } catch {
      // Listing / fetch / JSON parse failure — previous scores stay intact (§7.2 posture).
      await service.emitBenchmarkRefreshed(benchmark, 0, "parse_error");
    }
  }
  return written;
}
