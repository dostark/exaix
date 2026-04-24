/**
 * @module CandidateDiscoveryTest
 * @path tests/services/routing/candidate_discovery_test.ts
 * @description Unit tests for the routing candidate discovery logic.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { BlueprintLoader } from "../../../src/services/blueprint/blueprint_loader.ts";
import { CandidateDiscovery } from "../../../src/services/routing/candidate_discovery.ts";
import { readFixtureTextSync } from "../../helpers/fixtures.ts";

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
    const fixture_1 = readFixtureTextSync(
      import.meta.url,
      "services",
      "routing",
      "candidate_discovery_test",
      "fixture_1.md",
    );
    await Deno.writeTextFile(
      join(identitiesDir, "alpha.md"),
      fixture_1,
    );

    const fixture_2 = readFixtureTextSync(
      import.meta.url,
      "services",
      "routing",
      "candidate_discovery_test",
      "fixture_2.md",
    );
    await Deno.writeTextFile(
      join(identitiesDir, "beta.md"),
      fixture_2,
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
    const fixture_3 = readFixtureTextSync(
      import.meta.url,
      "services",
      "routing",
      "candidate_discovery_test",
      "fixture_3.md",
    );
    await Deno.writeTextFile(
      join(identitiesDir, "alpha.md"),
      fixture_3,
    );

    const fixture_4 = readFixtureTextSync(
      import.meta.url,
      "services",
      "routing",
      "candidate_discovery_test",
      "fixture_4.md",
    );
    await Deno.writeTextFile(
      join(identitiesDir, "beta.md"),
      fixture_4,
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
