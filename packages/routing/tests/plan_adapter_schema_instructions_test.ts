/**
 * @module PlanAdapterSchemaInstructionsTest
 * @path packages/routing/tests/plan_adapter_schema_instructions_test.ts
 * @description Tests that PlanAdapter.getSchemaInstructions(useXml) returns the correct
 *   format instructions: JSON when useXml is false/undefined, XML when useXml is true.
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_adapter.ts]
 */

import { assertEquals } from "@std/assert";
import { PlanAdapter } from "@exaix/core/planning";

const adapter = new PlanAdapter();

Deno.test("[SchemaInstructions] default (no arg) returns JSON schema instructions", () => {
  const instructions = adapter.getSchemaInstructions();
  assertEquals(instructions.includes("JSON object"), true);
  assertEquals(instructions.includes("<plan>"), false);
});

Deno.test("[SchemaInstructions] getSchemaInstructions(true) returns XML format instructions", () => {
  const instructions = adapter.getSchemaInstructions(true);
  assertEquals(instructions.includes("<plan>"), true);
  assertEquals(instructions.includes("<step number="), true);
  assertEquals(instructions.includes("<tool>"), true);
  assertEquals(instructions.includes("<params>"), true);
});

Deno.test("[SchemaInstructions] getSchemaInstructions(false) returns JSON instructions (same as default)", () => {
  const jsonDefault = adapter.getSchemaInstructions();
  const jsonExplicit = adapter.getSchemaInstructions(false);
  assertEquals(jsonExplicit, jsonDefault);
});
