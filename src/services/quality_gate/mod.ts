/**
 * @module QualityGateMod
 * @path src/services/quality_gate/mod.ts
 * @description Compatibility re-exports from @exaix/quality-gate package.
 * @deprecated Import directly from "@exaix/quality-gate" instead.
 * @architectural-layer Services
 * @related-files [packages/quality-gate]
 */

export {
  assessHeuristic,
  buildQualityGateConfig,
  ClarificationEngine,
  enrichRequest,
  type IClarificationEngineConfig,
  type IQualityGateTomlConfig,
  LlmQualityAssessor,
  loadClarification,
  RequestQualityGate,
  saveClarification,
} from "@exaix/quality-gate";
export type { IRequestQualityGateConfig } from "@exaix/core/types";
