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
import { CriterionResultSchema, EvaluationResultSchema, type IResolvedJudgeProfile } from "@exaix/core/evaluation";
import { zodToJsonSchema } from "./json_schema_adapter.ts";
import type { JSONValue } from "@exaix/core";
import { JsonSchemaType } from "@exaix/core";

/** The multi-criteria preset response format used by the LLM judge (e.g.
 *  GOAL_ALIGNED_REVIEW). Not cached, so a schema change at runtime is never stale. */
export function getEvaluationResultJsonSchema(): Record<string, JSONValue> {
  return zodToJsonSchema(EvaluationResultSchema);
}

/** The single-criterion judge response format, used when no preset is configured. Not
 *  cached, so a schema change at runtime is never stale. */
export function getCriterionResultJsonSchema(): Record<string, JSONValue> {
  const schema = zodToJsonSchema(CriterionResultSchema);
  // The requested output includes optional/defaulted fields so both CLIs can enforce it.
  schema.required = Object.keys(schema.properties as Record<string, JSONValue>);
  schema.additionalProperties = false;
  return schema;
}

/** Declares optional verdict metadata but requires only the score and reasoning consumed by a single-score evaluator. */
export function getJudgeScoreJsonSchema(): Record<string, JSONValue> {
  const schema = getCriterionResultJsonSchema();
  const consumed = zodToJsonSchema(CriterionResultSchema.pick({ score: true, reasoning: true }));
  schema.required = consumed.required;
  return schema;
}

/** Describe complete profile scores and the exclusive insufficient evidence response without sample scores. */
export function getJudgeProfileResponseJsonSchema(profile: IResolvedJudgeProfile): Record<string, JSONValue> {
  const criterion: Record<string, JSONValue> = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      score: { type: "number", minimum: 0, maximum: 1 },
      reasoning: { type: "string", minLength: 1 },
      issues: { type: JsonSchemaType.ARRAY, items: { type: "string" } },
      passed: { type: "boolean" },
    },
    required: ["score", "reasoning", "issues", "passed"],
  };
  const scored: Record<string, JSONValue> = {
    type: "object",
    additionalProperties: false,
    properties: {
      overallScore: { type: "number", minimum: 0, maximum: 1 },
      pass: { type: "boolean" },
      criteriaScores: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(profile.spec.criteria.map((entry) => [entry.name, criterion])),
        required: profile.spec.criteria.map((entry) => entry.name),
      },
      feedback: { type: "string" },
      suggestions: { type: JsonSchemaType.ARRAY, items: { type: "string" } },
      metadata: {
        type: "object",
        additionalProperties: false,
        properties: {
          evaluatedAt: { type: "string" },
          evaluatorAgent: { type: "string" },
          evaluationDurationMs: { type: "number" },
        },
        required: ["evaluatedAt"],
      },
    },
    required: ["overallScore", "criteriaScores", "pass", "feedback", "suggestions"],
  };
  const unavailable: Record<string, JSONValue> = {
    type: "object",
    additionalProperties: false,
    properties: {
      error: { type: "string", const: "insufficient_evidence" },
      missingEvidence: { type: JsonSchemaType.ARRAY, minItems: 1, items: { type: "string", minLength: 1 } },
    },
    required: ["error", "missingEvidence"],
  };
  return { type: "object", oneOf: [scored, unavailable] };
}
