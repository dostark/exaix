/**
 * @module EffectiveBudgetPolicy
 * @path packages/core/src/config/effective_budget_policy.ts
 * @description Resolves one runtime prompt-budget policy from TOML and Config DB inputs.
 * @architectural-layer Core
 * @related-files [
 *   "packages/core/src/config/adapter.ts",
 *   "packages/schemas/src/config.ts",
 *   "packages/core/src/prompt_budget_allocator.ts"
 * ]
 */

import type { Config } from "@exaix/schemas/config.ts";
import type { IBudgetPolicy } from "@exaix/schemas/prompt_budget.ts";
import type { Opt, Reason } from "@exaix/core/types";
import {
  DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED,
  DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED,
} from "../types/constants.ts";

export interface IBudgetOverrideReader {
  get<T>(key: string): T | undefined;
}

export const COST_TARGET_TOKENS_CONFIG_KEY = "budget.cost_target_tokens_per_request";

/** Config DB overrides public TOML, which overrides the legacy camelCase field. */
export function resolveEffectiveBudgetPolicy(
  config: Config,
  overrideReader?: Opt<IBudgetOverrideReader, Reason.OptionalInput>,
): IBudgetPolicy {
  const legacy = config.budget_enforcement;
  const costTargetTokens = overrideReader?.get<number>(COST_TARGET_TOKENS_CONFIG_KEY) ??
    config.budget?.cost_target_tokens_per_request ?? legacy?.costTargetTokens;
  return {
    cloud: legacy?.cloud ?? DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED,
    local: legacy?.local ?? DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED,
    enabled: legacy?.enabled,
    costTargetTokens,
  };
}
