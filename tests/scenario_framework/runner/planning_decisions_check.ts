#!/usr/bin/env -S deno run -A
/**
 * @module PlanningDecisionsCheck
 * @path tests/scenario_framework/runner/planning_decisions_check.ts
 * @description Checks a request-bound planning record without claiming semantic or file review.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/planning_decisions_check_test.ts]
 * Usage: deno run -A tests/scenario_framework/runner/planning_decisions_check.ts <case-id> <workspace-root> <request-id>
 */
import { readRequirementsArtifact } from "./requirements_artifact.ts";
import { evaluatePlanning } from "./planning_decisions_oracle.ts";
import { evaluateObservedArtifacts, type IPhase234Evaluation } from "./skill_evaluation_evidence.ts";

interface IPlanningRecordResult {
  recordPassed: boolean;
  reasons: string[];
  semanticReviewPending: boolean;
  fileInspectionPending: boolean;
  evaluation: IPhase234Evaluation;
}

/** Checks the structured record in the plan attributed to the submitted request. */
export async function checkPlanningRecord(
  caseId: string,
  root: string,
  requestId: string,
): Promise<IPlanningRecordResult> {
  const artifact = await readRequirementsArtifact(root, requestId);
  const result = evaluatePlanning(caseId, artifact);
  const evaluation = await evaluateObservedArtifacts(root, caseId, [artifact], [requestId]);
  return {
    recordPassed: result.ok,
    reasons: result.reasons,
    semanticReviewPending: true,
    fileInspectionPending: true,
    evaluation,
  };
}

if (import.meta.main) {
  try {
    const [caseId, root, requestId] = Deno.args;
    if (!caseId || !root || !requestId) throw new Error("Provide case, workspace and request identity");
    const result = await checkPlanningRecord(caseId, root, requestId);
    console.log(JSON.stringify({ caseId, requestId, ...result }));
    if (result.evaluation.overall !== "passed") Deno.exit(1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(2);
  }
}
