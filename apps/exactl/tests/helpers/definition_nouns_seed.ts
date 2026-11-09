/**
 * @module DefinitionNounsSeed
 * @path apps/exactl/tests/helpers/definition_nouns_seed.ts
 * @description Seeds one flow, which runs the agent that the test creates, and one portal target into a temporary exactl workspace.
 * @architectural-layer Test
 * @dependencies [@std/path, @exaix/shared]
 * @related-files [apps/exactl/tests/output_contract_definition_nouns_test.ts]
 */

import { join } from "@std/path";
import { DEFAULT_FLOWS_DIR } from "@exaix/shared";

export const SEEDED_FLOW_ID = "seed-flow";
export const SEEDED_AGENT_ID = "seed-agent";
export const SEEDED_PORTAL_ALIAS = "seedportal";
export const SEEDED_PORTAL_DIR = "portal-target";

const FLOW_YAML = `id: "${SEEDED_FLOW_ID}"
name: "Seed Flow"
description: "Flow of the sweep"
steps: [{ id: "s1", name: "Step 1", agent_role: "${SEEDED_AGENT_ID}", input: { source: "request", transform: "passthrough" } }]
output: { from: "s1", format: "markdown" }
`;

/** Writes a flow under the flows directory and an empty directory for a portal to point at. */
export async function seedDefinitionNouns(root: string): Promise<void> {
  const flowsDir = join(root, DEFAULT_FLOWS_DIR);
  await Deno.mkdir(flowsDir, { recursive: true });
  await Deno.writeTextFile(join(flowsDir, `${SEEDED_FLOW_ID}.flow.yaml`), FLOW_YAML);
  await Deno.mkdir(join(root, SEEDED_PORTAL_DIR), { recursive: true });
}
