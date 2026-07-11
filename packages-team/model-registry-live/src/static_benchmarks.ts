/**
 * @module StaticBenchmarks
 * @path packages-team/model-registry-live/src/static_benchmarks.ts
 * @description Phase 135 Step 7 (§5.8.1 curated Tier-2 floor, D4 typed-.ts pattern) — a
 *   small, hand-curated set of benchmark scores from public, citable publications. This
 *   floor loads unconditionally (no network, no license gate) so the top-N admission path
 *   and the Step 8 `best` scorer have data even with benchmark_source disabled. Scores are
 *   normalised to [0,1] (percentages divided by 100). Governance (§5.8.1): only citable
 *   public results — no leaderboard product is scraped. Provenance is always "static".
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix-team/model-registry-live]
 * @related-files [packages-team/model-registry-live/src/model_registry_service.ts]
 */
import { PROVIDER_ANTHROPIC, PROVIDER_GOOGLE, PROVIDER_OPENAI } from "@exaix/core/types";
import type { BenchmarkProvenance, IBenchmarkEntry } from "./model_registry_service.ts";

const SWE_BENCH_VERIFIED = "swe_bench_verified";
/** Every curated floor row is provenance "static" (§5.10). */
const STATIC_PROVENANCE: BenchmarkProvenance = "static";
// Epoch-ms floor timestamp for the curated set (2025-06-01); a fixed value keeps the
// upsert idempotent across re-applies rather than stamping Date.now() each load.
const CURATED_MEASURED_AT = 1_748_736_000_000;
const SWE_BENCH_URL = "https://www.swebench.com/";

/**
 * Curated SWE-bench Verified pass-rates from public provider/vendor announcements,
 * normalised to [0,1]. Kept intentionally small — this is a floor, not a leaderboard.
 */
export const STATIC_BENCHMARKS: IBenchmarkEntry[] = [
  {
    provider: PROVIDER_ANTHROPIC,
    model: "claude-opus-4-8",
    benchmark: SWE_BENCH_VERIFIED,
    score: 0.749,
    provenance: STATIC_PROVENANCE,
    measuredAt: CURATED_MEASURED_AT,
    sourceUrl: SWE_BENCH_URL,
  },
  {
    provider: PROVIDER_ANTHROPIC,
    model: "claude-sonnet-5",
    benchmark: SWE_BENCH_VERIFIED,
    score: 0.727,
    provenance: STATIC_PROVENANCE,
    measuredAt: CURATED_MEASURED_AT,
    sourceUrl: SWE_BENCH_URL,
  },
  {
    provider: PROVIDER_OPENAI,
    model: "gpt-5",
    benchmark: SWE_BENCH_VERIFIED,
    score: 0.749,
    provenance: STATIC_PROVENANCE,
    measuredAt: CURATED_MEASURED_AT,
    sourceUrl: SWE_BENCH_URL,
  },
  {
    provider: PROVIDER_GOOGLE,
    model: "gemini-2.5-pro",
    benchmark: SWE_BENCH_VERIFIED,
    score: 0.638,
    provenance: STATIC_PROVENANCE,
    measuredAt: CURATED_MEASURED_AT,
    sourceUrl: SWE_BENCH_URL,
  },
];
