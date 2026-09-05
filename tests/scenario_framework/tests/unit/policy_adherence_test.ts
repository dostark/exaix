/**
 * @module PolicyAdherenceTest
 * @path tests/scenario_framework/tests/unit/policy_adherence_test.ts
 * @description `checkPolicyAdherence`: a resolved wait-state's `metadata.resolvedBy` must match
 *   the simulator's declared actor identity; a mismatch or missing value is a bypass. A
 *   still-pending wait-state has nothing to check yet and is trivially adherent. Phase 145
 *   Step 2.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/policy_adherence.ts, apps/exactl/src/commands/wait_state_commands.ts]
 */

import { assertEquals } from "@std/assert";
import { checkPolicyAdherence } from "../../runner/policy_adherence.ts";

const EXPECTED_ACTOR = "user-simulator:cooperative";

Deno.test("[PolicyAdherence] fulfilled with matching resolvedBy is adherent", () => {
  const result = checkPolicyAdherence(
    { status: "fulfilled", metadata: { resolvedBy: EXPECTED_ACTOR } },
    EXPECTED_ACTOR,
  );
  assertEquals(result.adherent, true);
});

Deno.test("[PolicyAdherence] fulfilled with no resolvedBy is a bypass", () => {
  const result = checkPolicyAdherence({ status: "fulfilled", metadata: {} }, EXPECTED_ACTOR);
  assertEquals(result.adherent, false);
});

Deno.test("[PolicyAdherence] fulfilled with a mismatched resolvedBy is a bypass", () => {
  const result = checkPolicyAdherence(
    { status: "fulfilled", metadata: { resolvedBy: "someone-else" } },
    EXPECTED_ACTOR,
  );
  assertEquals(result.adherent, false);
});

Deno.test("[PolicyAdherence] fulfilled with no metadata at all is a bypass", () => {
  const result = checkPolicyAdherence({ status: "fulfilled" }, EXPECTED_ACTOR);
  assertEquals(result.adherent, false);
});

Deno.test("[PolicyAdherence] still-pending wait state is trivially adherent (nothing resolved yet)", () => {
  const result = checkPolicyAdherence({ status: "pending", metadata: {} }, EXPECTED_ACTOR);
  assertEquals(result.adherent, true);
});

Deno.test("[PolicyAdherence] rejected with matching resolvedBy is adherent", () => {
  const result = checkPolicyAdherence(
    { status: "rejected", metadata: { resolvedBy: EXPECTED_ACTOR } },
    EXPECTED_ACTOR,
  );
  assertEquals(result.adherent, true);
});
