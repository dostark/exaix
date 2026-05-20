import { assertEquals } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import { CandidateDiscovery } from "@exaix/routing";

interface TestBlueprintFrontmatter {
  deprecated?: boolean;
  [key: string]: JSONValue;
}

interface TestBlueprint {
  identityId: string;
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

Deno.test("CandidateDiscovery: returns explicit identity candidates first", async () => {
  const loader = new TestBlueprintLoader();
  loader.addBlueprint({
    identityId: "alpha",
    version: "1.0.0",
    capabilities: ["code_review"],
    frontmatter: {},
  });
  loader.addBlueprint({
    identityId: "beta",
    version: "2.0.0",
    capabilities: ["code_review"],
    frontmatter: {},
  });

  const discovery = new CandidateDiscovery(loader);
  const candidates = await discovery.listCandidates({ capability: "code_review", tags: [] }, "beta");

  assertEquals(candidates.length, 2);
  assertEquals(candidates[0].identityId, "beta");
});

Deno.test("CandidateDiscovery: filters candidates by capability and excludes deprecated ones", async () => {
  const loader = new TestBlueprintLoader();
  loader.addBlueprint({
    identityId: "alpha",
    version: "1.0.0",
    capabilities: ["documentation"],
    frontmatter: {},
  });
  loader.addBlueprint({
    identityId: "beta",
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
  assertEquals(deprecatedCandidates[0].identityId, "beta");
});
