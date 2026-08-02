/**
 * @module ScenarioFrameworkFlowCorpusReachabilityTest
 * @path tests/scenario_framework/tests/unit/flow_corpus_reachability_test.ts
 * @description Tests for Phase 158 Step 6's flow-corpus reachability: unlike a skill, a
 * flow has no "default" concept — a request only runs under a flow when one is
 * explicitly attached (Step 2's remediated Actions: flow-ablation/flow-swap arms reuse
 * the request frontmatter's flow: field directly). A flow is therefore corpus-reachable
 * only when the caller declares it was actually exercised against at least one corpus
 * task; flows with no such coverage are published on the non-coverage list.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/flow_corpus_reachability.ts]
 */

import { assertEquals } from "@std/assert";
import { computeFlowReachability } from "../../runner/flow_corpus_reachability.ts";
import type { IFlowCatalogEntry, IFlowTaskCoverage } from "../../runner/flow_corpus_reachability.ts";

function catalog(...flowIds: string[]): IFlowCatalogEntry[] {
  return flowIds.map((flowId) => ({ flowId }));
}

Deno.test("[FlowCorpusReachability] a flow exercised against at least one corpus task is reachable", () => {
  const coverage: IFlowTaskCoverage[] = [{ flowId: "refactoring", taskIds: ["swe-refactor-extract-function"] }];
  const result = computeFlowReachability(catalog("refactoring"), coverage);
  assertEquals(result.reachableFlowIds, ["refactoring"]);
  assertEquals(result.nonCoverage.length, 0);
});

Deno.test("[FlowCorpusReachability] a flow with no coverage entry at all is non-coverage, with a reason", () => {
  const result = computeFlowReachability(catalog("security_audit"), []);
  assertEquals(result.reachableFlowIds, []);
  assertEquals(result.nonCoverage.length, 1);
  assertEquals(result.nonCoverage[0].flowId, "security_audit");
  assertEquals(result.nonCoverage[0].reason.length > 0, true);
});

Deno.test("[FlowCorpusReachability] a flow with a coverage entry but zero task ids is still non-coverage", () => {
  const coverage: IFlowTaskCoverage[] = [{ flowId: "onboarding_docs", taskIds: [] }];
  const result = computeFlowReachability(catalog("onboarding_docs"), coverage);
  assertEquals(result.reachableFlowIds, []);
  assertEquals(result.nonCoverage[0].flowId, "onboarding_docs");
});

Deno.test("[FlowCorpusReachability] a coverage entry for a flow outside the catalog is not reported in either list", () => {
  const coverage: IFlowTaskCoverage[] = [{ flowId: "retired-flow", taskIds: ["some-task"] }];
  const result = computeFlowReachability(catalog("refactoring"), coverage);
  assertEquals(result.reachableFlowIds, []);
  assertEquals(result.nonCoverage.find((e) => e.flowId === "retired-flow"), undefined);
});
