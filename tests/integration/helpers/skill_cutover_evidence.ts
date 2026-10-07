/**
 * @module SkillCutoverEvidence
 * @path tests/integration/helpers/skill_cutover_evidence.ts
 * @description Assertions over the evidence of one real-daemon skill revision cutover. The evidence names the
 *   execution prompt, the canonical block of the approved revision, and the per-call usage rows of the skill. A
 *   substituted body, a wrong trace or revision, a dropped usage row or a missing drift event each fail the check.
 * @architectural-layer Test
 * @related-files [tests/integration/skill_revision_cutover_e2e_test.ts, tests/integration/skill_revision_cutover_evidence_test.ts]
 */

import { assert, assertEquals } from "@std/assert";

export interface ICutoverUsageRow {
  call_id: string;
  trace_id: string;
  revision_id: string;
  match_source: string;
}

export interface ICutoverDriftEvent {
  trace_id: string;
  pinned_revision_id: string;
  current_revision_id: string | null;
}

export interface ICutoverEvidence {
  /** The prompt the provider received for the execution call of request A. */
  executionPromptA: string;
  /** The block the approved revision renders to, built outside the daemon. */
  canonicalBlockA: string;
  /** Unique text that exists only in the edited revision. */
  markerB: string;
  revisionA: string;
  revisionB: string;
  traceA: string;
  traceB: string;
  /** Call ids retained from the provider and the journal, one per retained submission. */
  planningCallA: string;
  executionCallA: string;
  planningCallB: string;
  /** Rows of the skill joined from skill_usage and skill_revisions by name, for every retained call id. */
  usageRows: ICutoverUsageRow[];
  /** Distinct revision ids stored for the skill name. */
  storedRevisionIds: string[];
  driftEvents: ICutoverDriftEvent[];
}

function rowsOf(evidence: ICutoverEvidence, callId: string): ICutoverUsageRow[] {
  return evidence.usageRows.filter((row) => row.call_id === callId);
}

function assertOneUse(
  evidence: ICutoverEvidence,
  callId: string,
  traceId: string,
  revisionId: string,
): ICutoverUsageRow {
  const rows = rowsOf(evidence, callId);
  assertEquals(rows.length, 1, `call ${callId} must record exactly one use of the skill`);
  assertEquals(rows[0].trace_id, traceId, `call ${callId} belongs to the wrong trace`);
  assertEquals(rows[0].revision_id, revisionId, `call ${callId} used the wrong revision`);
  return rows[0];
}

/** Throws unless the evidence proves the cutover: exact approved content, one use per call, two stored revisions, one drift. */
export function verifyCutoverEvidence(evidence: ICutoverEvidence): void {
  assert(evidence.revisionA !== evidence.revisionB, "the edit must create a new revision");
  assert(
    evidence.executionPromptA.includes(evidence.canonicalBlockA),
    "the execution prompt of A must carry the exact canonical block of the approved revision",
  );
  assertEquals(
    evidence.executionPromptA.includes(evidence.markerB),
    false,
    "the execution prompt of A must never carry the edited content",
  );
  assertOneUse(evidence, evidence.planningCallA, evidence.traceA, evidence.revisionA);
  const execution = assertOneUse(evidence, evidence.executionCallA, evidence.traceA, evidence.revisionA);
  assertEquals(execution.match_source, "plan_pinned", "the execution call must use the pinned source");
  assertOneUse(evidence, evidence.planningCallB, evidence.traceB, evidence.revisionB);
  assertEquals(evidence.storedRevisionIds.length, 2, "exactly two revisions of the skill must be stored");
  assert(
    evidence.storedRevisionIds.includes(evidence.revisionA) && evidence.storedRevisionIds.includes(evidence.revisionB),
    "the stored revisions must be A and B",
  );
  assertEquals(evidence.driftEvents.length, 1, "drift must be journaled exactly once");
  assertEquals(evidence.driftEvents[0].trace_id, evidence.traceA);
  assertEquals(evidence.driftEvents[0].pinned_revision_id, evidence.revisionA);
  assertEquals(evidence.driftEvents[0].current_revision_id, evidence.revisionB);
}
