#!/usr/bin/env -S deno run -A
/**
 * @module RequirementsDiscoveryCheck
 * @path tests/scenario_framework/runner/requirements_discovery_check.ts
 * @description Checks requirements plans bound to separately submitted request identities.
 * @architectural-layer Test
 * @dependencies [requirements_artifact, requirements_discovery_oracle]
 * @related-files [tests/scenario_framework/runner/requirements_artifact.ts, tests/scenario_framework/runner/requirements_discovery_oracle.ts]
 * Usage: deno run -A tests/scenario_framework/runner/requirements_discovery_check.ts <case-id> <workspace-root> <request-id> [answered]
 */
import { readRequirementsArtifact, requirementsPlanIds } from "./requirements_artifact.ts";
import { evaluateRequirements } from "./requirements_discovery_oracle.ts";

async function main(): Promise<void> {
  const [caseId, root, requestId, turn] = Deno.args;
  if (!caseId || !root || !requestId) throw new Error("Provide case, workspace and request identity");
  const prior = await readRequirementsArtifact(root, requestId);
  if (turn !== "answered") {
    const result = evaluateRequirements(caseId, prior);
    console.log(JSON.stringify({ caseId, requestId, ...result }));
    Deno.exit(result.ok ? 0 : 1);
  }
  if (caseId !== "p234-s5-c2" || !evaluateRequirements(caseId, prior).ok) {
    throw new Error("An answer requires the valid pending retention artifact");
  }
  const ids = (await requirementsPlanIds(root)).filter((id) => id !== requestId);
  if (ids.length !== 1) throw new Error("The answer requires exactly one separately submitted request");
  const answer = await readRequirementsArtifact(root, ids[0]);
  const result = evaluateRequirements(caseId, answer, prior);
  console.log(JSON.stringify({ caseId, requestId: ids[0], priorRequestId: requestId, ...result }));
  Deno.exit(result.ok ? 0 : 1);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(2);
  }
}
