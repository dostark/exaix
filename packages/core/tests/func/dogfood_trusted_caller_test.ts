/**
 * @module DogfoodTrustedCallerTest
 * @path packages/core/tests/func/dogfood_trusted_caller_test.ts
 * @description Phase 176 Step 6 (GAP-11 remediation): isTrustedDogfoodCaller is the pure
 * comparison at the heart of binding dogfood context activation to a daemon-resolved
 * agent-role identity — a member of the trusted set is trusted, everything else (including
 * an absent/empty role) is not.
 * @architectural-layer Tests
 * @related-files [packages/core/src/func/dogfood_trusted_caller.ts]
 */

import { assertEquals } from "@std/assert";
import { isTrustedDogfoodCaller } from "@exaix/core/func";

const TRUSTED_ROLES = new Set(["dogfood-coder", "quality-judge"]);

Deno.test("[isTrustedDogfoodCaller] a role in the trusted set is trusted", () => {
  assertEquals(isTrustedDogfoodCaller("dogfood-coder", TRUSTED_ROLES), true);
  assertEquals(isTrustedDogfoodCaller("quality-judge", TRUSTED_ROLES), true);
});

Deno.test("[isTrustedDogfoodCaller] a role not in the trusted set is never trusted", () => {
  assertEquals(isTrustedDogfoodCaller("senior-coder", TRUSTED_ROLES), false);
  assertEquals(isTrustedDogfoodCaller("code-reviewer", TRUSTED_ROLES), false);
});

Deno.test("[isTrustedDogfoodCaller] an empty agentRole is never trusted, even against an empty set", () => {
  assertEquals(isTrustedDogfoodCaller("", TRUSTED_ROLES), false);
  assertEquals(isTrustedDogfoodCaller("", new Set()), false);
});

Deno.test("[isTrustedDogfoodCaller] an empty trusted set trusts nobody", () => {
  assertEquals(isTrustedDogfoodCaller("dogfood-coder", new Set()), false);
});
