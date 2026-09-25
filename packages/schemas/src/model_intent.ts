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

/** Canonical "auto" declaration value — the literal's single source for every surface
 *  that accepts a declaration-time value. */
// deno-lint-ignore prefer-as-const
export const EFFORT_AUTO: "auto" = "auto";

/** Declaration-time effort value. "auto" defers to EffortResolver; a concrete EffortTier
 *  bypasses resolution entirely (an explicit choice is never second-guessed). */
export const EffortDeclarationSchema = z.union([EffortTierSchema, z.literal(EFFORT_AUTO)]);
export type EffortDeclaration = z.infer<typeof EffortDeclarationSchema>;

/** Declaration-time thinking value — same "auto" semantics as effort. */
export const ThinkingDeclarationSchema = z.preprocess(
  // failsafe-YAML blueprints (BlueprintService) deliver booleans as strings
  (v) => (v === "true" ? true : v === "false" ? false : v),
  z.union([z.boolean(), z.literal(EFFORT_AUTO)]),
);
export type ThinkingDeclaration = z.infer<typeof ThinkingDeclarationSchema>;

/** The two declaration surfaces' field names — canonical constants so parse-boundary code
 *  (request/plan frontmatter) names the offending field without scattering literals, and so
 *  the field union is a shared named alias, per CODE_STYLE §2. */
export const DECLARATION_FIELD_EFFORT = "effort";
export const DECLARATION_FIELD_THINKING = "thinking";
export const DECLARATION_FIELDS = [DECLARATION_FIELD_EFFORT, DECLARATION_FIELD_THINKING] as const;
export type DeclarationField = typeof DECLARATION_FIELDS[number];

/** Why EffortResolver produced the value it did — journaled per request for
 *  measurement reproducibility. */
export const EffortResolutionBasisSchema = z.enum([
  "unset", // no surface declared a value -> field omitted (today's behavior)
  "declared", // caller gave a concrete value; resolver passed it through unchanged
  "native-adaptive", // thinking auto + Anthropic native-adaptive model + thinking_default != false -> omit the field
  "heuristic", // auto + a provider with no native adaptive default -> TaskComplexity-derived tier
  "role-floor", // resolved value raised to meet a role-kind policy floor (e.g. judges)
  "skill-floor", // resolved value raised to meet a matched skill's declared floor
]);
export type EffortResolutionBasis = z.infer<typeof EffortResolutionBasisSchema>;
