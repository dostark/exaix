/**
 * @module IHitlPolicyEvaluator
 * @path packages/core/src/types/i_hitl_policy_evaluator.ts
 * @description MIT interface for the Phase 118 per-action HITL policy evaluator.
 * Implemented by HitlPolicyEvaluator in packages-team/hitl/ (Team edition).
 * Solo default: no evaluator injected — no-op, zero overhead.
 * @architectural-layer Shared
 * @dependencies ["@exaix/schemas/hitl.ts"]
 * @related-files [packages/tool-runtime/src/tool_registry.ts]
 */

import type { HitlRule } from "@exaix/schemas/hitl.ts";
import type { HitlRuleSource } from "./enums.ts";
import type { LogMetadata } from "./json.ts";

export interface IHitlPolicyEvaluator {
  evaluate(
    blueprintRules: HitlRule[],
    toolName: string,
    toolArgs: LogMetadata,
  ): { rule: HitlRule; source: HitlRuleSource } | null;
}
