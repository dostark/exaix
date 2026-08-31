/**
 * @module ScenarioFrameworkJournalPayloadAbsentTest
 * @path tests/scenario_framework/tests/unit/journal_payload_absent_test.ts
 * @description Phase 127 Step 7 (PG-1 remediation) — RED-first tests for the additive
 *   `payload_absent` predicate on the `journal-event-exists` criterion. The clean-cell
 *   matrix assertion must mean "ACCEPTED reconcile", not merely "a reconciled event of any
 *   kind exists": the session-return watcher journals `session.delegate.reconciled` BOTH on
 *   the accepted path (`{ decision }`) AND on a non-scope rejection (`{ rejected: true }`),
 *   and a bare event-type match cannot tell them apart. `payload_absent: { rejected: true }`
 *   requires a matching event whose parsed payload does NOT carry that key/value, so a
 *   rejected-but-reconciled outcome fails the cell.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/schema/step_schema.ts, apps/daemon/src/session_return_watcher.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { evaluateCriterion } from "../../runner/assertions.ts";
import { CriterionKind, CriterionPhase, CriterionStatus } from "../../schema/step_schema.ts";

/** IActivityRecord.payload is a JSON-STRING field — these NDJSON rows mirror that shape. */
const ACCEPTED_ROW = JSON.stringify({
  action_type: "session.delegate.reconciled",
  payload: JSON.stringify({ decision: { id: "d1" } }),
});
const REJECTED_ROW = JSON.stringify({
  action_type: "session.delegate.reconciled",
  payload: JSON.stringify({ rejected: true, reason: "budget" }),
});

async function evalPayloadAbsent(
  rows: string[],
): Promise<CriterionStatus> {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-payload-absent-" });
  try {
    await Deno.writeTextFile(join(workspaceRoot, "journal.ndjson"), rows.join("\n") + "\n");
    const result = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "reconciled-accepted",
        kind: CriterionKind.JOURNAL_EVENT_EXISTS,
        event_type: "session.delegate.reconciled",
        journal_file: "journal.ndjson",
        payload_absent: { rejected: true },
      },
    });
    return result.status;
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
}

Deno.test("[journal_payload_absent] passes when an accepted reconcile event has no rejected:true payload", async () => {
  assertEquals(await evalPayloadAbsent([ACCEPTED_ROW]), CriterionStatus.PASSED);
});

Deno.test("[journal_payload_absent] fails when the only reconcile event carries rejected:true (the PG-1 case)", async () => {
  assertEquals(await evalPayloadAbsent([REJECTED_ROW]), CriterionStatus.FAILED);
});

Deno.test("[journal_payload_absent] fails when NO matching event exists at all (event-type still required)", async () => {
  const otherRow = JSON.stringify({ action_type: "request.created", payload: "{}" });
  assertEquals(await evalPayloadAbsent([otherRow]), CriterionStatus.FAILED);
});

Deno.test("[journal_payload_absent] passes when at least one accepted event exists alongside a rejected one", async () => {
  // The watcher emits one event per return; but a robust predicate should PASS if ANY
  // matching event satisfies the absence (a clean run happened), even amid noise.
  assertEquals(await evalPayloadAbsent([REJECTED_ROW, ACCEPTED_ROW]), CriterionStatus.PASSED);
});

Deno.test("[journal_payload_absent] a plain journal-event-exists (no payload_absent) is unchanged — bare event-type match still passes", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-payload-absent-compat-" });
  try {
    // Even a rejected reconcile satisfies the OLD bare predicate (backward-compat).
    await Deno.writeTextFile(join(workspaceRoot, "journal.ndjson"), REJECTED_ROW + "\n");
    const result = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "reconciled-bare",
        kind: CriterionKind.JOURNAL_EVENT_EXISTS,
        event_type: "session.delegate.reconciled",
        journal_file: "journal.ndjson",
      },
    });
    assertEquals(result.status, CriterionStatus.PASSED);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});
