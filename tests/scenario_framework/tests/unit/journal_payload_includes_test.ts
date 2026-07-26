/**
 * @module ScenarioFrameworkJournalPayloadIncludesTest
 * @path tests/scenario_framework/tests/unit/journal_payload_includes_test.ts
 * @description Phase 142 Step 17E — RED-first tests for the additive `payload_includes`
 *   predicate on `journal-event-exists`. The skill_eval pin scenarios asserted only that a
 *   skill event of some type existed, which is satisfied by a run that resolved the WRONG
 *   skills — or none. What those scenarios actually test is that ids pinned in request
 *   frontmatter survive parsing and reach the resolved set, so the assertion has to read the
 *   id arrays out of the `skills.resolved` payload.
 *
 *   `payload_absent` compares whole values; membership is the useful predicate for an id
 *   array, so this checks that each listed string appears IN the named payload array.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/schema/step_schema.ts, packages/execution/src/agent_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { evaluateCriterion } from "../../runner/assertions.ts";
import { CriterionKind, CriterionPhase, CriterionStatus } from "../../schema/step_schema.ts";

/** Mirrors the CLI journal shape: `payload` arrives as a JSON string. */
function resolvedRow(skillIds: string[], pinned: string[] = skillIds): string {
  return JSON.stringify({
    action_type: "skills.resolved",
    payload: JSON.stringify({ skill_ids: skillIds, pinned_skill_ids: pinned, skill_count: skillIds.length }),
  });
}

async function evalIncludes(
  rows: string[],
  includes: Record<string, string[]>,
): Promise<CriterionStatus> {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-payload-includes-" });
  try {
    await Deno.writeTextFile(join(workspaceRoot, "journal.ndjson"), rows.join("\n") + "\n");
    const result = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "skills-resolved",
        kind: CriterionKind.JOURNAL_EVENT_EXISTS,
        event_type: "skills.resolved",
        journal_file: "journal.ndjson",
        payload_includes: includes,
      },
    });
    return result.status;
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
}

Deno.test("[journal_payload_includes] passes when the payload array contains every listed id", async () => {
  assertEquals(
    await evalIncludes([resolvedRow(["tdd-methodology", "security-first", "response-contract"])], {
      skill_ids: ["tdd-methodology", "security-first"],
    }),
    CriterionStatus.PASSED,
  );
});

Deno.test("[journal_payload_includes] fails when one listed id is missing from the array", async () => {
  assertEquals(
    await evalIncludes([resolvedRow(["tdd-methodology"])], {
      skill_ids: ["tdd-methodology", "security-first"],
    }),
    CriterionStatus.FAILED,
  );
});

Deno.test("[journal_payload_includes] a pin that never reached the resolved set fails the cell", async () => {
  // The exact regression the predicate exists to catch: the event fires, so a bare
  // event-type match would pass, but the pinned id was dropped somewhere in parsing.
  assertEquals(
    await evalIncludes([resolvedRow(["response-contract"], [])], { pinned_skill_ids: ["tdd-methodology"] }),
    CriterionStatus.FAILED,
  );
});

Deno.test("[journal_payload_includes] passes when a later event satisfies it amid non-matching ones", async () => {
  assertEquals(
    await evalIncludes([resolvedRow(["response-contract"]), resolvedRow(["tdd-methodology"])], {
      skill_ids: ["tdd-methodology"],
    }),
    CriterionStatus.PASSED,
  );
});

Deno.test("[journal_payload_includes] fails when no event of the type exists at all", async () => {
  const otherRow = JSON.stringify({ action_type: "request.created", payload: "{}" });
  assertEquals(await evalIncludes([otherRow], { skill_ids: ["tdd-methodology"] }), CriterionStatus.FAILED);
});

Deno.test("[journal_payload_includes] a bare journal-event-exists is unchanged", async () => {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "scenario-payload-includes-compat-" });
  try {
    await Deno.writeTextFile(join(workspaceRoot, "journal.ndjson"), resolvedRow([]) + "\n");
    const result = await evaluateCriterion({
      workspaceRoot,
      phase: CriterionPhase.OUTPUT,
      criterion: {
        id: "skills-resolved-bare",
        kind: CriterionKind.JOURNAL_EVENT_EXISTS,
        event_type: "skills.resolved",
        journal_file: "journal.ndjson",
      },
    });
    assertEquals(result.status, CriterionStatus.PASSED);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});
