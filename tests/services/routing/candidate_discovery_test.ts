/**
 * @module CandidateDiscoveryTest
 * @path tests/services/routing/candidate_discovery_test.ts
 * @description Unit tests for the routing candidate discovery logic.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { BlueprintLoader } from "../../../src/services/blueprint/blueprint_loader.ts";
import { CandidateDiscovery } from "../../../src/services/routing/candidate_discovery.ts";

let testDir: string;
let blueprintsPath: string;
let identitiesDir: string;

async function setup() {
  testDir = await Deno.makeTempDir({ prefix: "exa_candidate_discovery_test_" });
  blueprintsPath = join(testDir, "Blueprints");
  identitiesDir = join(blueprintsPath, "Identities");
  await Deno.mkdir(identitiesDir, { recursive: true });
  return { testDir, blueprintsPath, identitiesDir };
}

async function teardown(dir: string) {
  try {
    await Deno.remove(dir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

Deno.test("CandidateDiscovery: returns explicit identity candidates first", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    await Deno.writeTextFile(
      join(identitiesDir, "alpha.md"),
      `---
identity_id: "alpha"
name: "Alpha"
capabilities: ["code_review"]
version: "1.0.0"
---
Alpha agent
`,
    );

    await Deno.writeTextFile(
      join(identitiesDir, "beta.md"),
      `---
identity_id: "beta"
name: "Beta"
capabilities: ["code_review"]
version: "1.0.0"
---
Beta agent
`,
    );

    const loader = new BlueprintLoader({ blueprintsPath });
    const discovery = new CandidateDiscovery(loader);
    const candidates = await discovery.listCandidates({ capability: "code_review", tags: [] }, "beta");

    assertEquals(candidates.length, 2);
    assertEquals(candidates[0].identityId, "beta");
  } finally {
    await teardown(testDir);
  }
});

Deno.test("CandidateDiscovery: filters candidates by capability and excludes deprecated ones", async () => {
  const { blueprintsPath, identitiesDir, testDir } = await setup();

  try {
    await Deno.writeTextFile(
      join(identitiesDir, "alpha.md"),
      `---
identity_id: "alpha"
name: "Alpha"
capabilities: ["analysis"]
version: "1.0.0"
---
Alpha agent
`,
    );

    await Deno.writeTextFile(
      join(identitiesDir, "beta.md"),
      `---
identity_id: "beta"
name: "Beta"
capabilities: ["code_review"]
version: "1.0.0"
deprecated: true
---
Beta agent
`,
    );

    const loader = new BlueprintLoader({ blueprintsPath });
    const discovery = new CandidateDiscovery(loader);
    const candidates = await discovery.listCandidates({ capability: "code_review", tags: [] });

    assertEquals(candidates.length, 0);

    const discoveryWithDeprecated = new CandidateDiscovery(loader, { allowDeprecated: true });
    const deprecatedCandidates = await discoveryWithDeprecated.listCandidates({ capability: "code_review", tags: [] });

    assertEquals(deprecatedCandidates.length, 1);
    assertEquals(deprecatedCandidates[0].identityId, "beta");
  } finally {
    await teardown(testDir);
  }
});
