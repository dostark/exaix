/** @module CandidateDiscoveryTest
 * @path packages/routing/tests/candidate_discovery_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description TODO: Add description */
import { assertEquals } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import { CandidateDiscovery } from "@exaix/routing";

interface TestBlueprintFrontmatter {
  deprecated?: boolean;
  [key: string]: JSONValue;
}

interface TestBlueprint {
  agentRole: string;
  version: string;
  capabilities: string[];
  frontmatter: TestBlueprintFrontmatter;
}

class TestBlueprintLoader {
  private blueprints: TestBlueprint[] = [];

  addBlueprint(bp: TestBlueprint): void {
    this.blueprints.push(bp);
  }

  listAll(): Promise<TestBlueprint[]> {
    return Promise.resolve(this.blueprints);
  }
}

Deno.test("CandidateDiscovery: returns explicit agent-role candidates first", async () => {
  const loader = new TestBlueprintLoader();
  loader.addBlueprint({
    agentRole: "alpha",
    version: "1.0.0",
    capabilities: ["code_review"],
    frontmatter: {},
  });
  loader.addBlueprint({
    agentRole: "beta",
    version: "2.0.0",
    capabilities: ["code_review"],
    frontmatter: {},
  });

  const discovery = new CandidateDiscovery(loader);
  const candidates = await discovery.listCandidates({ capability: "code_review", tags: [] }, "beta");

  assertEquals(candidates.length, 2);
  assertEquals(candidates[0].agentRole, "beta");
});

Deno.test("CandidateDiscovery: filters candidates by capability and excludes deprecated ones", async () => {
  const loader = new TestBlueprintLoader();
  loader.addBlueprint({
    agentRole: "alpha",
    version: "1.0.0",
    capabilities: ["documentation"],
    frontmatter: {},
  });
  loader.addBlueprint({
    agentRole: "beta",
    version: "2.0.0",
    capabilities: ["code_review"],
    frontmatter: { deprecated: true },
  });

  const discovery = new CandidateDiscovery(loader);
  const candidates = await discovery.listCandidates({ capability: "code_review", tags: [] });

  assertEquals(candidates.length, 0);

  const discoveryWithDeprecated = new CandidateDiscovery(loader, { allowDeprecated: true });
  const deprecatedCandidates = await discoveryWithDeprecated.listCandidates({ capability: "code_review", tags: [] });

  assertEquals(deprecatedCandidates.length, 1);
  assertEquals(deprecatedCandidates[0].agentRole, "beta");
});
