/**
 * @module SkillEvaluationTypes
 * @path tests/scenario_framework/runner/skill_evaluation_types.ts
 * @description The evidence result contract shared by the skill-delivery observation and the skill-evaluation evidence.
 * @architectural-layer TestSupport
 * @dependencies []
 * @related-files [tests/scenario_framework/runner/skill_delivery_observation.ts, tests/scenario_framework/runner/skill_evaluation_evidence.ts]
 */

export type EvidenceStatus = "passed" | "failed" | "pending";
export interface IEvidenceResult {
  status: EvidenceStatus;
  reasons: string[];
}
