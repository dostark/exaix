/**
 * @module SkillRevisionCutoverEvidenceTest
 * @path tests/integration/skill_revision_cutover_evidence_test.ts
 * @description Negative canaries for the cutover evidence check. Evidence that is correct passes, and each
 *   deliberate substitution of the edited body, revision, trace or usage row makes the check fail.
 * @architectural-layer Test
 * @related-files [tests/integration/helpers/skill_cutover_evidence.ts]
 */

import { assertThrows } from "@std/assert";
import { type ICutoverEvidence, verifyCutoverEvidence } from "./helpers/skill_cutover_evidence.ts";

const BLOCK = "#### code-review\nOriginal body.\n";

function goodEvidence(): ICutoverEvidence {
  return {
    executionPromptA: `intro\n${BLOCK}\noutro`,
    canonicalBlockA: BLOCK,
    markerB: "EDIT_MARKER_B",
    revisionA: "revision-a",
    revisionB: "revision-b",
    traceA: "trace-a",
    traceB: "trace-b",
    planningCallA: "call-plan-a",
    executionCallA: "call-exec-a",
    planningCallB: "call-plan-b",
    usageRows: [
      { call_id: "call-plan-a", trace_id: "trace-a", revision_id: "revision-a", match_source: "pinned" },
      { call_id: "call-exec-a", trace_id: "trace-a", revision_id: "revision-a", match_source: "plan_pinned" },
      { call_id: "call-plan-b", trace_id: "trace-b", revision_id: "revision-b", match_source: "pinned" },
    ],
    storedRevisionIds: ["revision-a", "revision-b"],
    driftEvents: [{ trace_id: "trace-a", pinned_revision_id: "revision-a", current_revision_id: "revision-b" }],
  };
}

Deno.test("[cutover evidence] correct evidence passes", () => {
  verifyCutoverEvidence(goodEvidence());
});

Deno.test("[cutover evidence] substituting the edited body into the execution transport fails", () => {
  const evidence = goodEvidence();
  evidence.executionPromptA = "intro\n#### code-review\nOriginal body.\nEDIT_MARKER_B\n";
  assertThrows(() => verifyCutoverEvidence(evidence));
  const swapped = goodEvidence();
  swapped.executionPromptA = `intro\n${BLOCK.replace("Original", "Edited")}\n`;
  assertThrows(() => verifyCutoverEvidence(swapped));
});

Deno.test("[cutover evidence] the edited revision in A's execution row fails", () => {
  const evidence = goodEvidence();
  evidence.usageRows[1] = { ...evidence.usageRows[1], revision_id: "revision-b" };
  assertThrows(() => verifyCutoverEvidence(evidence));
});

Deno.test("[cutover evidence] a wrong trace on a retained call fails", () => {
  const evidence = goodEvidence();
  evidence.usageRows[2] = { ...evidence.usageRows[2], trace_id: "trace-a" };
  assertThrows(() => verifyCutoverEvidence(evidence));
});

Deno.test("[cutover evidence] a dropped or duplicated usage row fails", () => {
  const dropped = goodEvidence();
  dropped.usageRows.splice(1, 1);
  assertThrows(() => verifyCutoverEvidence(dropped));
  const duplicated = goodEvidence();
  duplicated.usageRows.push({ ...duplicated.usageRows[0] });
  assertThrows(() => verifyCutoverEvidence(duplicated));
});

Deno.test("[cutover evidence] a live-sourced execution row, a missing revision and a wrong drift count fail", () => {
  const live = goodEvidence();
  live.usageRows[1] = { ...live.usageRows[1], match_source: "matched" };
  assertThrows(() => verifyCutoverEvidence(live));
  const missing = goodEvidence();
  missing.storedRevisionIds = ["revision-a"];
  assertThrows(() => verifyCutoverEvidence(missing));
  const noDrift = goodEvidence();
  noDrift.driftEvents = [];
  assertThrows(() => verifyCutoverEvidence(noDrift));
  const twice = goodEvidence();
  twice.driftEvents.push({ ...twice.driftEvents[0] });
  assertThrows(() => verifyCutoverEvidence(twice));
});
