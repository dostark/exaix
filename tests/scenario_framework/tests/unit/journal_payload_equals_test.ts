/**
 * @module ScenarioFrameworkJournalPayloadEqualsTest
 * @path tests/scenario_framework/tests/unit/journal_payload_equals_test.ts
 * @description Phase-197 Step 15 (GAP-8) — RED-first tests for the additive `payload_equals`
 *   predicate on the `journal-event-exists` criterion: a matching event must carry, at each
 *   dotted-path key (e.g. `heuristic_inputs.complexity_source`), a SCALAR equal to the given
 *   value, and a MISSING key fails — turning the earlier presence-only live assertions into
 *   value assertions that can prove the effort basis/tier a leg actually emitted.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/schema/step_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { evaluateCriterion } from "../../runner/assertions.ts";
import { CriterionKind, CriterionPhase, CriterionStatus } from "../../schema/step_schema.ts";

const EVENT_EFFORT_RESOLVED = "agent.effort_resolved";
const JOURNAL_FILE = "journal.ndjson";
const PAYLOAD_KEY_EFFORT_BASIS = "effort_basis";
const PAYLOAD_KEY_EFFORT = "effort";
const PATH_COMPLEXITY_SOURCE = "heuristic_inputs.complexity_source";
const VALUE_BASIS_HEURISTIC = "heuristic";
const VALUE_EFFORT_HIGH = "high";
const VALUE_COMPLEXITY_ANALYSIS = "analysis";

const MATCHING_ROW = JSON.stringify({
  action_type: EVENT_EFFORT_RESOLVED,
  payload: JSON.stringify({
    [PAYLOAD_KEY_EFFORT_BASIS]: VALUE_BASIS_HEURISTIC,
    [PAYLOAD_KEY_EFFORT]: VALUE_EFFORT_HIGH,
    heuristic_inputs: { complexity_source: VALUE_COMPLEXITY_ANALYSIS },
  }),
});

async function evalPayloadEquals(rows: string[], equals: Record<string, string>): Promise<CriterionStatus> {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-payload-equals-" });
  try {
    await Deno.writeTextFile(join(workspaceRoot, JOURNAL_FILE), rows.join("\n") + "\n");
    const result = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "effort-value",
        kind: CriterionKind.JOURNAL_EVENT_EXISTS,
        event_type: EVENT_EFFORT_RESOLVED,
        journal_file: JOURNAL_FILE,
        payload_equals: equals,
      },
    });
    return result.status;
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
}

Deno.test("[journal_payload_equals] passes when the payload matches a top-level scalar", async () => {
  assertEquals(
    await evalPayloadEquals([MATCHING_ROW], { [PAYLOAD_KEY_EFFORT_BASIS]: VALUE_BASIS_HEURISTIC }),
    CriterionStatus.PASSED,
  );
});

Deno.test("[journal_payload_equals] passes when the payload matches a dotted-path scalar", async () => {
  assertEquals(
    await evalPayloadEquals([MATCHING_ROW], { [PATH_COMPLEXITY_SOURCE]: VALUE_COMPLEXITY_ANALYSIS }),
    CriterionStatus.PASSED,
  );
});

Deno.test("[journal_payload_equals] fails when a named key is MISSING from the payload", async () => {
  assertEquals(await evalPayloadEquals([MATCHING_ROW], { missing_key: "x" }), CriterionStatus.FAILED);
});

Deno.test("[journal_payload_equals] fails when the scalar differs", async () => {
  assertEquals(await evalPayloadEquals([MATCHING_ROW], { [PAYLOAD_KEY_EFFORT]: "medium" }), CriterionStatus.FAILED);
});

Deno.test("[journal_payload_equals] fails when NO matching event exists", async () => {
  assertEquals(
    await evalPayloadEquals([], { [PAYLOAD_KEY_EFFORT_BASIS]: VALUE_BASIS_HEURISTIC }),
    CriterionStatus.FAILED,
  );
});

Deno.test("[journal_payload_equals] a plain journal-event-exists (no payload_equals) still passes on a bare match (backward-compat)", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-payload-equals-compat-" });
  try {
    await Deno.writeTextFile(join(workspaceRoot, JOURNAL_FILE), MATCHING_ROW + "\n");
    const result = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "bare-match",
        kind: CriterionKind.JOURNAL_EVENT_EXISTS,
        event_type: EVENT_EFFORT_RESOLVED,
        journal_file: JOURNAL_FILE,
      },
    });
    assertEquals(result.status, CriterionStatus.PASSED);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});
