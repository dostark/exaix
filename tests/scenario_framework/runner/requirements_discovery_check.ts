#!/usr/bin/env -S deno run -A
/**
 * @module RequirementsDiscoveryCheck
 * @path tests/scenario_framework/runner/requirements_discovery_check.ts
 * @description Checks requirements plans bound to separately submitted request identities.
 * @architectural-layer Test
 * @dependencies [requirements_artifact, requirements_discovery_oracle]
 * @related-files [tests/scenario_framework/runner/requirements_artifact.ts, tests/scenario_framework/runner/requirements_discovery_oracle.ts]
 * Usage: deno run -A tests/scenario_framework/runner/requirements_discovery_check.ts <case-id> <workspace-root> <request-id> [initial|answered] [diagnostic|evaluate]
 */
import { readRequirementsArtifact, requirementsPlanIds } from "./requirements_artifact.ts";
import { evaluateRequirements } from "./requirements_discovery_oracle.ts";
import { evaluateObservedArtifacts } from "./skill_evaluation_evidence.ts";

async function main(): Promise<void> {
  const [caseId, root, requestId, turn, mode] = Deno.args;
  if (!caseId || !root || !requestId) throw new Error("Provide case, workspace and request identity");
  const prior = await readRequirementsArtifact(root, requestId);
  if (turn !== "answered") {
    const result = evaluateRequirements(caseId, prior);
    const evaluation = mode === "evaluate"
      ? await evaluateObservedArtifacts(root, caseId, [prior], [requestId])
      : undefined;
    console.log(
      JSON.stringify(
        mode === "diagnostic" || mode === "evaluate"
          ? { caseId, requestId, legacyDiagnostic: result, evaluation }
          : { caseId, requestId, ...result },
      ),
    );
    Deno.exit(
      mode === "diagnostic" ? 0 : mode === "evaluate" ? (evaluation?.overall === "passed" ? 0 : 1) : result.ok ? 0 : 1,
    );
  }
  if (
    caseId !== "p234-s5-c2" || (mode !== "diagnostic" && mode !== "evaluate" && !evaluateRequirements(caseId, prior).ok)
  ) {
    throw new Error("An answer requires the valid pending retention artifact");
  }
  const ids = (await requirementsPlanIds(root)).filter((id) => id !== requestId);
  if (ids.length !== 1) throw new Error("The answer requires exactly one separately submitted request");
  const answer = await readRequirementsArtifact(root, ids[0]);
  const result = evaluateRequirements(caseId, answer, prior);
  const evaluation = mode === "evaluate"
    ? await evaluateObservedArtifacts(root, caseId, [prior, answer], [requestId, ids[0]])
    : undefined;
  console.log(
    JSON.stringify(
      mode === "diagnostic" || mode === "evaluate"
        ? { caseId, requestId: ids[0], priorRequestId: requestId, legacyDiagnostic: result, evaluation }
        : { caseId, requestId: ids[0], priorRequestId: requestId, ...result },
    ),
  );
  Deno.exit(
    mode === "diagnostic" ? 0 : mode === "evaluate" ? (evaluation?.overall === "passed" ? 0 : 1) : result.ok ? 0 : 1,
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(2);
  }
}
