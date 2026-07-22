/**
 * @module EvaluationJsonSchema
 * @path packages/schemas/src/evaluation_json_schema.ts
 * @description JSON Schema generation for LLM judge evaluation responses.
 *   Provides schema-enforced structured output for the judge evaluation path
 *   via CLI --json-schema flags (e.g. claude-code's --json-schema), closing
 *   a gap where the judge path relied solely on prompt instructions.
 * @architectural-layer Shared
 * @dependencies [@exaix/core/evaluation/evaluation_criteria.ts, zodToJsonSchema]
 * @related-files [packages/schemas/src/json_schema_adapter.ts, tests/scenario_framework/runner/assertions.ts]
 */
import { CriterionResultSchema, EvaluationResultSchema } from "@exaix/core/evaluation/evaluation_criteria.ts";
import { zodToJsonSchema } from "./json_schema_adapter.ts";
import type { JSONValue } from "@exaix/core";

/**
 * Returns a JSON Schema derived from EvaluationResultSchema — the multi-criteria
 * preset response format used by the LLM judge (e.g. GOAL_ALIGNED_REVIEW).
 * Not cached, so a schema change at runtime is never stale.
 */
export function getEvaluationResultJsonSchema(): Record<string, JSONValue> {
  return zodToJsonSchema(EvaluationResultSchema);
}

/**
 * Returns a JSON Schema derived from CriterionResultSchema — the single-criterion
 * judge response format. Used when no preset is configured.
 * Not cached, so a schema change at runtime is never stale.
 */
export function getCriterionResultJsonSchema(): Record<string, JSONValue> {
  return zodToJsonSchema(CriterionResultSchema);
}
