/**
 * @module CapabilitiesTest
 * @path packages/core/tests/capabilities_test.ts
 * @description Unit tests for edition capability constants.
 */

import { assertEquals } from "@std/assert";
import { EDITION_TEAM } from "../mod.ts";
import {
  CAP_EXTENDED_LANG_EXTRACTION,
  CAP_GUARDRAIL_ADVANCED,
  CAP_HITL_GOVERNANCE,
  CAP_OPENROUTER_TEAM,
  CAP_VOTING,
  CAPABILITY_EDITION,
} from "../src/composer/mod.ts";

Deno.test("capabilities: all expected capability IDs are defined", () => {
  assertEquals(CAP_VOTING, "voting");
  assertEquals(CAP_HITL_GOVERNANCE, "hitl_governance");
  assertEquals(CAP_GUARDRAIL_ADVANCED, "guardrail_advanced");
  assertEquals(CAP_OPENROUTER_TEAM, "openrouter_team");
  assertEquals(CAP_EXTENDED_LANG_EXTRACTION, "extended_lang_extraction");
});

Deno.test("capabilities: each capability maps to the correct edition tier", () => {
  assertEquals(CAPABILITY_EDITION[CAP_VOTING], EDITION_TEAM);
  assertEquals(CAPABILITY_EDITION[CAP_HITL_GOVERNANCE], EDITION_TEAM);
  assertEquals(CAPABILITY_EDITION[CAP_GUARDRAIL_ADVANCED], EDITION_TEAM);
  assertEquals(CAPABILITY_EDITION[CAP_OPENROUTER_TEAM], EDITION_TEAM);
  assertEquals(CAPABILITY_EDITION[CAP_EXTENDED_LANG_EXTRACTION], EDITION_TEAM);
});

Deno.test("capabilities: all defined capabilities have an edition mapping", () => {
  for (const [id, tier] of Object.entries(CAPABILITY_EDITION)) {
    assertEquals(typeof id, "string", `Capability ID must be a string: ${id}`);
    assertEquals(typeof tier, "string", `Edition tier must be a string for ${id}`);
  }
});
