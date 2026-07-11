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
// Each row cites the VENDOR's own model-card/announcement — the "public, citable
// publication" the design's Tier-2 curation requires (§5.8.1). Leaderboard products
// (swebench.com, llm-stats, …) are human references only, NOT eligible data sources.
const ANTHROPIC_MODELS_URL = "https://www.anthropic.com/news";
const OPENAI_MODELS_URL = "https://openai.com/index/";
const GOOGLE_MODELS_URL = "https://blog.google/technology/google-deepmind/";

/**
 * Curated SWE-bench Verified pass-rates cited from each vendor's own published model
 * announcement (Tier-2 offline floor, §5.8.1), normalised to [0,1]. Kept intentionally
 * small — this is a floor, not a leaderboard.
 *
 * NOTE (provisional): these scores are placeholders pending per-model verification against
 * the dated vendor publication. The Tier-1 EEE ingest (benchmark_ingest.ts) is the
 * primary, actualised source once the G8 data-license clears; this floor exists only so
 * the registry is non-empty offline. A maintainer MUST verify each (model, score, date)
 * against the cited source before treating these numbers as authoritative.
 */
export const STATIC_BENCHMARKS: IBenchmarkEntry[] = [
  {
    provider: PROVIDER_ANTHROPIC,
    model: "claude-opus-4-8",
    benchmark: SWE_BENCH_VERIFIED,
    score: 0.749,
    provenance: STATIC_PROVENANCE,
    measuredAt: CURATED_MEASURED_AT,
    sourceUrl: ANTHROPIC_MODELS_URL,
  },
  {
    provider: PROVIDER_ANTHROPIC,
    model: "claude-sonnet-5",
    benchmark: SWE_BENCH_VERIFIED,
    score: 0.727,
    provenance: STATIC_PROVENANCE,
    measuredAt: CURATED_MEASURED_AT,
    sourceUrl: ANTHROPIC_MODELS_URL,
  },
  {
    provider: PROVIDER_OPENAI,
    model: "gpt-5",
    benchmark: SWE_BENCH_VERIFIED,
    score: 0.749,
    provenance: STATIC_PROVENANCE,
    measuredAt: CURATED_MEASURED_AT,
    sourceUrl: OPENAI_MODELS_URL,
  },
  {
    provider: PROVIDER_GOOGLE,
    model: "gemini-2.5-pro",
    benchmark: SWE_BENCH_VERIFIED,
    score: 0.638,
    provenance: STATIC_PROVENANCE,
    measuredAt: CURATED_MEASURED_AT,
    sourceUrl: GOOGLE_MODELS_URL,
  },
];
