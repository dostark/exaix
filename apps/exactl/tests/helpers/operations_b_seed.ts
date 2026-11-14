/**
 * @module OperationsBSeed
 * @path apps/exactl/tests/helpers/operations_b_seed.ts
 * @description Seeds two agent roles and a request file in a temporary exactl workspace for the routing leaves.
 * @architectural-layer Test
 * @related-files [apps/exactl/tests/output_contract_operations_b_test.ts, apps/exactl/tests/model_command_cli_test.ts]
 */

import * as pathBuilders from "@exaix/shared";
import { DEFAULT_AGENTS_PATH } from "@exaix/shared";
import { readFixtureTextSync } from "@exaix/testing";
import { join } from "@std/path";

/** The request file that the routing leaves read, relative to the workspace root. */
export const ROUTING_REQUEST_FILE = "request.md";

/** Writes the two role fixtures and one request addressed to `senior-coder` into `root`. */
export async function seedRoutingWorkspace(root: string): Promise<void> {
  const blueprintsDir = pathBuilders.blueprintsPath(root, DEFAULT_AGENTS_PATH);
  await Deno.mkdir(blueprintsDir, { recursive: true });
  const fixture = (name: string) =>
    readFixtureTextSync(import.meta.url, "cli", "commands", "routing_commands_test", name);
  await Deno.writeTextFile(join(blueprintsDir, "senior-coder.md"), fixture("fixture_1.md"));
  await Deno.writeTextFile(join(blueprintsDir, "default-agent.md"), fixture("fixture_2.md"));
  await Deno.writeTextFile(
    join(root, ROUTING_REQUEST_FILE),
    "---\ntrace_id: trace-1\nagent_role: senior-coder\nallow_dynamic_routing: true\n---\nPlease generate code for the new feature.\n",
  );
}
