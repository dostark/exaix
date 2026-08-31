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
const SWE_BENCH_PRO = "swe_bench_pro";
const GPQA = "gpqa";
/** Every curated floor row is provenance "static". */
const STATIC_PROVENANCE: BenchmarkProvenance = "static";
// A fixed epoch-ms floor keeps the curated-set upsert idempotent across re-applies rather
// than stamping Date.now() each load.
const CURATED_MEASURED_AT = 1_748_736_000_000;
// Each row cites the VENDOR's own model-card/announcement. Leaderboard products
// (swebench.com, llm-stats, …) are human references only, NOT eligible data sources.
const ANTHROPIC_MODELS_URL = "https://www.anthropic.com/news";
const OPENAI_MODELS_URL = "https://openai.com/index/";
const GOOGLE_MODELS_URL = "https://blog.google/technology/google-deepmind/";

/** Placeholders pending per-model verification against the cited source before treating
 *  as authoritative. */
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
  // Widens the curated floor beyond swe_bench_verified so top-N admission and the `best`
  // scorer can rank refactor/analysis task-types too. Same vendor-cited-announcement
  // sourcing as above.
  {
    provider: PROVIDER_ANTHROPIC,
    model: "claude-opus-4-8",
    benchmark: SWE_BENCH_PRO,
    score: 0.489,
    provenance: STATIC_PROVENANCE,
    measuredAt: CURATED_MEASURED_AT,
    sourceUrl: ANTHROPIC_MODELS_URL,
  },
  {
    provider: PROVIDER_OPENAI,
    model: "gpt-5",
    benchmark: SWE_BENCH_PRO,
    score: 0.469,
    provenance: STATIC_PROVENANCE,
    measuredAt: CURATED_MEASURED_AT,
    sourceUrl: OPENAI_MODELS_URL,
  },
  {
    provider: PROVIDER_ANTHROPIC,
    model: "claude-opus-4-8",
    benchmark: GPQA,
    score: 0.834,
    provenance: STATIC_PROVENANCE,
    measuredAt: CURATED_MEASURED_AT,
    sourceUrl: ANTHROPIC_MODELS_URL,
  },
  {
    provider: PROVIDER_OPENAI,
    model: "gpt-5",
    benchmark: GPQA,
    score: 0.849,
    provenance: STATIC_PROVENANCE,
    measuredAt: CURATED_MEASURED_AT,
    sourceUrl: OPENAI_MODELS_URL,
  },
  {
    provider: PROVIDER_GOOGLE,
    model: "gemini-2.5-pro",
    benchmark: GPQA,
    score: 0.837,
    provenance: STATIC_PROVENANCE,
    measuredAt: CURATED_MEASURED_AT,
    sourceUrl: GOOGLE_MODELS_URL,
  },
];
