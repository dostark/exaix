/**
 * @module Admission
 * @path packages-team/model-registry-live/src/adapters/admission.ts
 * @description Phase 135 Step 3 (§5.9, F12) — the registry-write admission filter.
 *   An adapter's fetchCatalog returns the FULL provider list; the registry admits only
 *   the worthwhile subset before the atomic swap. A model is admitted if ANY path
 *   holds: native (a first-party non-aggregator provider kept whole), user-curated,
 *   previously-used, or top-N of a tracked benchmark (Step 7, G6 — the caller resolves
 *   the top-N set from model_benchmark). Each admitted model carries the reason it was
 *   admitted, emitted as model.admitted for auditability.
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix/model-registry]
 * @related-files [packages-team/model-registry-live/src/model_registry_service.ts]
 */
import type { ICatalogEntry } from "@exaix/model-registry";

/** Reason a model cleared the admission bar (§5.9 union of paths). */
export type AdmissionReason = "curated" | "native" | "explicit_use" | "benchmark_topn";

/** Inputs the registry supplies to the admission filter for one provider refresh. */
export interface IAdmissionInputs {
  /** Models named in any curated list — always admitted. */
  curatedModels: Set<string>;
  /** Models seen in provider_costs (previously used) — always admitted. */
  usedModels: Set<string>;
  /** True when the provider is an aggregator reseller (OpenRouter); natives are false. */
  isAggregator: boolean;
  /** Admit all first-party models of native (non-aggregator) providers. */
  keepNativeWhole: boolean;
  /** Top-N benchmark bound (the caller resolves the actual top-N set into benchmarkTopN). */
  topN: number;
  /** Models in the top-`topN` of any tracked benchmark — always admitted. */
  benchmarkTopN: Set<string>;
}

/** An admitted catalog entry paired with the reason it cleared the bar. */
export interface IAdmittedEntry {
  entry: ICatalogEntry;
  reason: AdmissionReason;
}

/**
 * Applies the §5.9 admission union to a catalog; curation/prior-use win over the native
 * path so the reported reason reflects the user's explicit trust first.
 */
export function admit(entries: ICatalogEntry[], inputs: IAdmissionInputs): IAdmittedEntry[] {
  const admitted: IAdmittedEntry[] = [];
  for (const entry of entries) {
    const reason = admissionReason(entry.model, inputs);
    if (reason) admitted.push({ entry, reason });
  }
  return admitted;
}

function admissionReason(model: string, inputs: IAdmissionInputs): AdmissionReason | null {
  if (inputs.curatedModels.has(model)) return "curated";
  if (inputs.usedModels.has(model)) return "explicit_use";
  if (!inputs.isAggregator && inputs.keepNativeWhole) return "native";
  // A model in the top-N of any tracked benchmark clears the bar even on an aggregator
  // with no curation/prior-use. Empty set (no benchmarks) ⇒ inert.
  if (inputs.benchmarkTopN.has(model)) return "benchmark_topn";
  return null;
}
