/**
 * @module ModelIntent
 * @path packages/schemas/src/model_intent.ts
 * @description Phase 132 — unified ModelIntent type merging IModelPreferences and ISelectionCriteria.
 *   Callers declare intent (size, thinking, effort, characteristics) and ModelResolver
 *   resolves it to a concrete provider:model with per-call options.
 * @architectural-layer Shared
 * @dependencies [@exaix/schemas]
 * @related-files [packages/ai/src/model_resolver.ts, packages/schemas/src/model_intent.ts]
 */

/**
 * Model size tier — maps to a capability profile (context window, thinking, cost).
 * Phase 134 will support arbitrary sizes via IModelRegistry.
 */
export type ModelSize = "S" | "M" | "L" | "XL";

/**
 * Reasoning effort tier — normalized across providers.
 * Provider-specific mapping: low→minimal tokens, high→extended thinking budget.
 */
export type EffortTier = "low" | "medium" | "high";

/**
 * Per-call options returned by ModelResolver and passed to provider.generate().
 * Maps directly onto IModelOptions (extended in packages/ai/src/types.ts).
 */
export interface IModelCallOptions {
  thinking?: boolean;
  effort?: EffortTier;
  max_tokens?: number;
}

/**
 * Unified intent type for model resolution. Merges IModelPreferences and ISelectionCriteria.
 * All fields are optional; explicit `model` (provider:model) bypasses the resolver entirely.
 */
export interface ModelIntent {
  preferred_provider?: string;
  model_size?: ModelSize;
  characteristics?: string[];
  thinking?: boolean;
  effort?: EffortTier;
  required_capabilities?: string[];
  max_cost_usd?: number;
  allow_local?: boolean;
  model?: string;
  fallbacks?: Partial<ModelIntent>[];
  context_window_fallback?: boolean;
}

/**
 * Full resolution result from ModelResolver.
 * Extends the Phase 131 IResolvedModel with per-call options and fallback attempt count.
 */
export interface IResolvedModel {
  provider: string;
  model: string;
  options?: IModelCallOptions;
  attempt?: number;
}

/**
 * Reason enum for model resolution trace events.
 * Each value corresponds to a specific resolution path in ModelResolver.
 */
export type ModelResolutionReason =
  | "explicit_override"
  | "characteristics_scored"
  | "preset_default"
  | "fallback"
  | "thinking_constrained"
  | "context_window_overflow";

/**
 * Trace payload emitted on every ModelResolver.resolve() call.
 * Full audit trail: input intent, candidates considered, scores, selection, duration.
 */
export interface IModelResolutionTrace {
  intent: ModelIntent;
  candidate_providers: string[];
  scores: Record<string, number>;
  selected: { provider: string; model: string; attempt: number };
  reason: ModelResolutionReason;
  duration_ms: number;
}
