/**
 * @module BlueprintLoaderOutputContractTest
 * @path packages/core/tests/blueprint/blueprint_loader_output_contract_test.ts
 * @description Verifies that the output_contract frontmatter key reaches the runtime blueprint and rejects unknown values.
 * @architectural-layer Core
 * @related-files [packages/core/src/blueprint/blueprint_loader.ts]
 */

import * as pathBuilders from "@exaix/shared";
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { OutputContract } from "@exaix/core";
import { BlueprintLoadError, IBlueprintLoader } from "@exaix/core/blueprint";

async function loadRole(frontmatterLine: string): Promise<IBlueprintLoader & { role: string; dir: string }> {
  const dir = await Deno.makeTempDir({ prefix: "exa_output_contract_" });
  const blueprintsPath = pathBuilders.blueprintsPath(dir);
  const agentsDir = pathBuilders.agentsPath(blueprintsPath);
  await Deno.mkdir(agentsDir, { recursive: true });
  await Deno.writeTextFile(
    join(agentsDir, "contract-role.md"),
    `---\nagent_role: contract-role\nmodel: mock:mock\ncapabilities: [analysis]\nversion: "1.0.0"\n${frontmatterLine}\n---\n\nPrompt.\n`,
  );
  return Object.assign(new IBlueprintLoader({ blueprintsPath }), { role: "contract-role", dir });
}

Deno.test("fix(blueprint): output_contract reaches the legacy blueprint", async () => {
  const loader = await loadRole("output_contract: verdict");
  try {
    const loaded = await loader.load(loader.role);
    assertEquals(loaded && loader.toLegacyBlueprint(loaded).outputContract, OutputContract.VERDICT);
  } finally {
    await Deno.remove(loader.dir, { recursive: true });
  }
});

Deno.test("fix(blueprint): an unknown output_contract fails to load", async () => {
  const loader = await loadRole("output_contract: free-form");
  try {
    await assertRejects(() => loader.load(loader.role), BlueprintLoadError);
  } finally {
    await Deno.remove(loader.dir, { recursive: true });
  }
});
