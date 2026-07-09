/**
 * @module CapabilitiesTest
 * @path packages/core/tests/capabilities_test.ts
 * @description Unit tests for edition capability constants (incl. Phase 134 Step 5 —
 *   CAP_MODEL_REGISTRY_LIVE/ROUTING_RIGOR to EDITION_TEAM, CAP_MODEL_REGISTRY_GOVERNANCE
 *   to EDITION_ENTERPRISE reserved per D11).
 */

import { assertEquals } from "@std/assert";
import { EDITION_ENTERPRISE, EDITION_TEAM } from "../mod.ts";
import {
  CAP_EXTENDED_LANG_EXTRACTION,
  CAP_GUARDRAIL_ADVANCED,
  CAP_HITL_GOVERNANCE,
  CAP_MODEL_REGISTRY_GOVERNANCE,
  CAP_MODEL_REGISTRY_LIVE,
  CAP_MODEL_ROUTING_RIGOR,
  CAP_VOTING,
  CAPABILITY_EDITION,
} from "../src/composer/mod.ts";

Deno.test("capabilities: all expected capability IDs are defined", () => {
  assertEquals(CAP_VOTING, "voting");
  assertEquals(CAP_HITL_GOVERNANCE, "hitl_governance");
  assertEquals(CAP_GUARDRAIL_ADVANCED, "guardrail_advanced");
  assertEquals(CAP_EXTENDED_LANG_EXTRACTION, "extended_lang_extraction");
  assertEquals(CAP_MODEL_REGISTRY_LIVE, "model_registry_live");
  assertEquals(CAP_MODEL_ROUTING_RIGOR, "model_routing_rigor");
  assertEquals(CAP_MODEL_REGISTRY_GOVERNANCE, "model_registry_governance");
});

Deno.test("capabilities: each capability maps to the correct edition tier", () => {
  assertEquals(CAPABILITY_EDITION[CAP_VOTING], EDITION_TEAM);
  assertEquals(CAPABILITY_EDITION[CAP_HITL_GOVERNANCE], EDITION_TEAM);
  assertEquals(CAPABILITY_EDITION[CAP_GUARDRAIL_ADVANCED], EDITION_TEAM);
  assertEquals(CAPABILITY_EDITION[CAP_EXTENDED_LANG_EXTRACTION], EDITION_TEAM);
  assertEquals(CAPABILITY_EDITION[CAP_MODEL_REGISTRY_LIVE], EDITION_TEAM);
  assertEquals(CAPABILITY_EDITION[CAP_MODEL_ROUTING_RIGOR], EDITION_TEAM);
  assertEquals(CAPABILITY_EDITION[CAP_MODEL_REGISTRY_GOVERNANCE], EDITION_ENTERPRISE);
});

Deno.test("capabilities: OpenRouter is NOT a Team-gated capability (Solo per D5b)", () => {
  assertEquals(CAPABILITY_EDITION["openrouter_team"], undefined);
});

Deno.test("capabilities: all defined capabilities have an edition mapping", () => {
  for (const [id, tier] of Object.entries(CAPABILITY_EDITION)) {
    assertEquals(typeof id, "string", `Capability ID must be a string: ${id}`);
    assertEquals(typeof tier, "string", `Edition tier must be a string for ${id}`);
  }
});
