/**
 * @module ScenarioPinSchemaTest
 * @path tests/scenario_framework/tests/unit/scenario_pin_schema_test.ts
 * @description Verifies the scenario `pin` list: each entry needs a note, and two pins may not share a selector.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/scenario_schema.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { SCHEMA_VERSION } from "../../schema/version.ts";

const BASE = {
  schema_version: SCHEMA_VERSION,
  id: "pin-schema",
  title: "Pin schema",
  pack: "agent_flows",
  tags: ["smoke"],
  request_fixture: "fixtures/requests/agent_flows/openai_compatible_native.md",
  mode_support: ["auto"],
  portals: [],
  steps: [{ id: "submit", type: "exactl", command: "request" }],
  bindings: { default: { service: "alpha" }, judge: { service: "alpha" } },
};
const PIN = { selector: "default", fields: ["service"], reason: "capability-gate", note: "frozen" };

Deno.test("[pins] a pin list with distinct selectors parses", () => {
  const parsed = ScenarioSchema.parse({ ...BASE, pin: [PIN, { ...PIN, selector: "judge" }] });
  assertEquals(parsed.pin?.map((pin) => pin.selector), ["default", "judge"]);
});

Deno.test("[pins] duplicate pin selectors are rejected", () => {
  const result = ScenarioSchema.safeParse({ ...BASE, pin: [PIN, { ...PIN, fields: ["model"] }] });
  assert(!result.success);
  assert(result.error.issues.some((issue) => issue.message.includes("default")));
});

Deno.test("[pins] a pin without a note is rejected", () => {
  const { note: _note, ...withoutNote } = PIN;
  assert(!ScenarioSchema.safeParse({ ...BASE, pin: [withoutNote] }).success);
});

Deno.test("[pins] the single-object pin form is no longer accepted", () => {
  assert(!ScenarioSchema.safeParse({ ...BASE, pin: PIN }).success);
});
