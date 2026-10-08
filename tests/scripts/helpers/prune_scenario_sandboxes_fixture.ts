/**
 * @module PruneScenarioSandboxesFixture
 * @path tests/scripts/helpers/prune_scenario_sandboxes_fixture.ts
 * @description Shared scaffolding for the prune_scenario_sandboxes tests: seeded sandbox
 *   roots with controlled modification times.
 * @architectural-layer Testing
 * @related-files [tests/scripts/prune_scenario_sandboxes_test.ts, tests/scripts/prune_scenario_sandboxes_security_test.ts]
 */

import { join } from "@std/path";

export interface ISeededSandbox {
  name: string;
  ageDays: number;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export async function seedSandboxRoot(entries: ISeededSandbox[]): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "prune-sandboxes-" });
  const now = Date.now();
  for (const entry of entries) {
    const dir = join(root, entry.name);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(join(dir, "exa.config.toml"), "[system]\n");
    const stamp = new Date(now - entry.ageDays * DAY_MS);
    await Deno.utime(dir, stamp, stamp);
  }
  return root;
}
