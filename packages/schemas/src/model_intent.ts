/**
 * @module IModelIntent
 * @path packages/schemas/src/model_intent.ts
 * @description Phase 132 — unified IModelIntent type merging IModelPreferences and ISelectionCriteria.
 *   Callers declare intent (size, thinking, effort, characteristics) and ModelResolver
 *   resolves it to a concrete provider:model with per-call options.
 * @architectural-layer Shared
 * @dependencies [@exaix/schemas, @exaix/core]
 * @related-files [packages/ai/src/model_resolver.ts, packages/schemas/src/model_intent.ts]
 */
import type { JSONValue, TaskType } from "@exaix/core";
import { z } from "zod";

/** Model size tier — maps to a capability profile (context window, thinking, cost). */
export type ModelSize = "S" | "M" | "L" | "XL";

/** Reasoning effort tier, normalized across providers (low→minimal tokens, high→extended thinking budget). */
export type EffortTier = z.infer<typeof EffortTierSchema>;

/** Per-call options returned by ModelResolver and passed to provider.generate(); maps onto IModelOptions (packages/ai/src/types.ts). */
export interface IModelCallOptions {
  thinking?: boolean;
  effort?: EffortTier;
  max_tokens?: number;
  /** JSON Schema enforcement for structured output (e.g. claude-code --json-schema).
   *  Ignored by providers that do not support it. */
  jsonSchema?: Record<string, JSONValue>;
}

/** Unified intent type for model resolution, merging IModelPreferences and ISelectionCriteria. All fields optional; explicit `model` bypasses the resolver entirely. */
export interface IModelIntent {
  preferred_provider?: string;
  model_size?: ModelSize;
  characteristics?: string[];
  thinking?: boolean;
  effort?: EffortTier;
  required_capabilities?: string[];
  max_cost_usd?: number;
  allow_local?: boolean;
  model?: string;
  fallbacks?: Partial<IModelIntent>[];
  context_window_fallback?: boolean;
  /** Estimated input tokens for context-window overflow detection. When context_window_fallback is true, overflow bumps model_size one tier (S→M→L→XL) and re-resolves; requires a size-bearing intent. */
  estimated_input_tokens?: number;
  /** The derived or declared task type driving the `best` scorer's benchmark_map lookup (Team). Rides the intent/trace in Solo without affecting selection. */
  task_type?: TaskType;
  /** How task_type was derived; rides the intent to the trace. */
  task_type_source?: TaskTypeSource;
}

/** The precedence source that decided the derived task_type. */
export type TaskTypeSource = "frontmatter" | "agent_role" | "skill" | "static_map" | "analyzer" | "unknown";

/** @deprecated Use IModelIntent instead. Backward-compat alias. */
export type IModelPreferences = IModelIntent;

/** @deprecated Use IModelIntent instead. Backward-compat alias. */
export type ISelectionCriteria = IModelIntent;

/** Full resolution result from ModelResolver, extending IResolvedModel with per-call options and fallback attempt count. */
/** Why a particular route (provider) was chosen for a model with 1+ routes. `single_route` / `pinned` are the no-policy cases; the rest name the policy that decided. Additive to IResolvedModel, absent in Solo. */
export type IRouteReason =
  | "single_route"
  | "cheapest"
  | "reliability"
  | "native_first"
  | "user_order"
  | "pinned";

export interface IResolvedModel {
  provider: string;
  model: string;
  options?: IModelCallOptions;
  attempt?: number;
  /** Which route policy chose this provider (absent in Solo). */
  route_reason?: IRouteReason;
}

/** Reason enum for model resolution trace events; each value corresponds to a specific resolution path in ModelResolver. */
export type ModelResolutionReason =
  | "explicit_override"
  | "characteristics_scored"
  | "preset_default"
  | "fallback"
  | "thinking_constrained"
  | "context_window_overflow"
  | "preferred_list"
  /** `best` characteristic was decisive (benchmark_map ranking). */
  | "best_ranked"
  /** F8: the opt-in usage tiebreak decided a formerly-random pick. */
  | "usage_ranked";

/** Trace payload emitted on every ModelResolver.resolve() call: input intent, candidates considered, scores, selection, and duration. */
export interface IModelResolutionTrace {
  intent: IModelIntent;
  candidate_providers: string[];
  scores: Record<string, number>;
  selected: { provider: string; model: string; attempt: number };
  reason: ModelResolutionReason;
  duration_ms: number;
}

/** Zod enum for the reasoning effort tiers, so intent parsing and validation round-trip
 *  through a schema. */
export const EffortTierSchema = z.enum(["low", "medium", "high"]);
