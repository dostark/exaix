/**
 * @module AdvancedFlowTypes
 * @path tests/scenario_framework/tests/helpers/advanced_flow_types.ts
 * @description The advanced-flow case and evidence contracts shared by the case runner and the evidence writer.
 * @architectural-layer TestSupport
 * @dependencies [@exaix/core/types, @exaix/schemas]
 * @related-files [tests/scenario_framework/tests/helpers/advanced_flow_case.ts, tests/scenario_framework/tests/helpers/advanced_flow_evidence.ts]
 */

import type { IActivityRecord } from "@exaix/core/types";
import type { BindingLockSchema, RunBindingsFileSchema } from "@exaix/schemas";

export interface IAdvancedFlowCase {
  file: string;
  scenarioId: string;
  action: string;
  status: string;
  phaseStep: number;
  evaluations: number;
  iterations: number;
  edition: string;
}

export interface IAdvancedFlowCaseEvidence {
  scenarioId: string;
  edition: string;
  requestTrace: string;
  flowRunId: string;
  activities: IActivityRecord[];
  binaries: Array<{ path: string; sha256: string }>;
  configSha256: string;
  locks: Array<ReturnType<typeof BindingLockSchema.parse>>;
  runBindings: Array<ReturnType<typeof RunBindingsFileSchema.parse>>;
}
