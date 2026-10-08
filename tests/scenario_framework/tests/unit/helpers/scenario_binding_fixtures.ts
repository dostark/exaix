/**
 * @module ScenarioBindingFixtures
 * @path tests/scenario_framework/tests/unit/helpers/scenario_binding_fixtures.ts
 * @description Shared fixtures for the scenario binding-layer tests: a minimal valid scenario
 *   built through the schema, so the schema (not a cast) proves the new fields exist.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/scenario_schema.ts]
 */

import { type IScenario, ScenarioSchema } from "../../../schema/scenario_schema.ts";
import { SCHEMA_VERSION } from "../../../schema/version.ts";

/** A minimal valid scenario, so the schema (not a cast) proves the new fields exist. */
export function scenarioWith(extra: Partial<IScenario> = {}): IScenario {
  return ScenarioSchema.parse({
    schema_version: SCHEMA_VERSION,
    id: "bindings-smoke",
    title: "Bindings smoke",
    pack: "agent_flows",
    tags: ["smoke"],
    request_fixture: "fixtures/requests/agent_flows/openai_compatible_native.md",
    mode_support: ["auto"],
    portals: [],
    steps: [{ id: "submit", type: "exactl", command: "request" }],
    ...extra,
  });
}
