/**
 * @module FlowEvalParityTest
 * @path tests/eval/flow_eval_parity_test.ts
 * @description Parity test asserting every Blueprints/Flows/*.flow.yaml has at
 *   least one eval scenario tagged entity:<flow-id>.flow, minus exclusions.
 */
import { assertEquals } from "@std/assert";
import { assertCatalogCovered } from "./catalog_parity.ts";
import parityExclusions from "./parity_exclusions.json" with { type: "json" };

const flowBlueprintIds = [
  "analyze-codebase",
  "api_design",
  "api_documentation",
  "bug_investigation",
  "code_review",
  "consensus_review",
  "documentation",
  "dogfood_loop",
  "feature_development",
  "migration_planning",
  "onboarding_docs",
  "pr_review",
  "refactoring",
  "research_synthesis",
  "security_audit",
  "test_generation",
];

const flowEntityIds = flowBlueprintIds.map((id) => `${id}.flow`);

const flowExclusions: string[] = (parityExclusions.flows ?? []).map(
  (e: { id: string }) => e.id,
);

Deno.test("flow_eval_parity — all 16 flow blueprints have entity tags", () => {
  assertEquals(flowBlueprintIds.length, 16);
  const missing = assertCatalogCovered({
    catalogIds: flowEntityIds,
    scenarioCatalog: [],
    subsystemTag: "subsystem:flows",
    exclusions: flowExclusions,
  });
  const expectedMissing = flowEntityIds.filter(
    (id) => !flowExclusions.includes(id),
  );
  assertEquals(
    new Set(missing),
    new Set(expectedMissing),
  );
});

Deno.test("flow_eval_parity — all pass when scenarios exist", () => {
  const scenarioCatalog = flowEntityIds.map((entityId) => ({
    id: `${entityId}_test`,
    tags: ["subsystem:flows", `entity:${entityId}`],
  }));
  const missing = assertCatalogCovered({
    catalogIds: flowEntityIds,
    scenarioCatalog,
    subsystemTag: "subsystem:flows",
    exclusions: flowExclusions,
  });
  assertEquals(missing, []);
});
