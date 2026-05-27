/** @module RoutingPolicyServicePreferLocalTest
 * @path packages/routing/tests/routing_policy_service_prefer_local_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description Tests for preferLocal routing behavior */
import { assertEquals } from "@std/assert";
import type { IRoutingCandidate, IRoutingPolicy } from "@exaix/schemas/routing_policy.ts";
import type { JSONValue } from "@exaix/core";
import { CandidateDiscovery } from "@exaix/routing";
import { createRoutingCandidate, createRoutingPolicyService } from "./routing_policy_test_helper.ts";

Deno.test("RoutingPolicyService: prefers local candidate in fallback when preferLocal set", async () => {
  const policy: IRoutingPolicy = { version: "1.0", allowExperiments: false, defaultMode: "policy_first", rules: [] };
  const localCandidate = createRoutingCandidate({
    identityId: "local-agent",
    version: "1.0.0",
    capabilities: ["code_review"],
    score: 0.5,
    preferLocal: true,
  });
  const remoteCandidate = createRoutingCandidate({
    identityId: "remote-agent",
    version: "2.0.0",
    capabilities: ["code_review"],
    score: 0.8,
    preferLocal: false,
  });

  const service = createRoutingPolicyService(
    policy,
    [remoteCandidate, localCandidate],
  );

  const decision = await service.selectIdentity({ matchCriteria: { capability: "code_review", tags: [] } });

  assertEquals(
    decision.selectedIdentityId,
    "local-agent",
    "Should prefer local even with lower score",
  );
});

Deno.test("CandidateDiscovery: extracts preferLocal from blueprint frontmatter", async () => {
  interface TestBlueprintFrontmatter {
    deprecated?: boolean;
    routing_prefer_local?: boolean;
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

  const loader = new TestBlueprintLoader();
  loader.addBlueprint({
    identityId: "local-agent",
    version: "1.0.0",
    capabilities: ["code_review"],
    frontmatter: { routing_prefer_local: true },
  });
  loader.addBlueprint({
    identityId: "remote-agent",
    version: "2.0.0",
    capabilities: ["code_review"],
    frontmatter: {},
  });

  const discovery = new CandidateDiscovery(loader);
  const candidates = await discovery.listCandidates({ capability: "code_review", tags: [] });

  const localCandidate = candidates.find((c: IRoutingCandidate) => c.identityId === "local-agent");
  const remoteCandidate = candidates.find((c: IRoutingCandidate) => c.identityId === "remote-agent");

  assertEquals(localCandidate?.preferLocal, true);
  assertEquals(remoteCandidate?.preferLocal, undefined);
});
