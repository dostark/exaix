/**
 * @module ScenarioFrameworkFlowCorpusReachability
 * @path tests/scenario_framework/runner/flow_corpus_reachability.ts
 * @description Phase 158 Step 6's flow-corpus reachability: unlike a skill, a flow has
 * no "default" concept — a request only runs under a flow when one is explicitly
 * attached (Step 2's remediated Actions: flow-ablation/flow-swap arms reuse the request
 * frontmatter's flow: field directly, no overlay mechanism). A flow is therefore
 * corpus-reachable only when the caller declares it was actually exercised against at
 * least one corpus task. Pure computation only, matching skill_corpus_reachability.ts's
 * pattern — declaring which flows apply to which corpus tasks is the caller's concern.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/flow_corpus_reachability_test.ts, tests/scenario_framework/runner/skill_corpus_reachability.ts]
 */

export interface IFlowCatalogEntry {
  flowId: string;
}

/** The corpus task ids a flow was actually exercised against, declared by the caller. */
export interface IFlowTaskCoverage {
  flowId: string;
  taskIds: string[];
}

export interface IFlowNonCoverageEntry {
  flowId: string;
  reason: string;
}

export interface IFlowReachabilityResult {
  reachableFlowIds: string[];
  nonCoverage: IFlowNonCoverageEntry[];
}

/** A catalog flow is reachable when its coverage entry names at least one corpus task. A coverage entry for a flow outside the catalog is ignored rather than reported. */
export function computeFlowReachability(
  catalog: IFlowCatalogEntry[],
  coverage: IFlowTaskCoverage[],
): IFlowReachabilityResult {
  const taskIdsByFlow = new Map(coverage.map((entry) => [entry.flowId, entry.taskIds]));

  const reachableFlowIds: string[] = [];
  const nonCoverage: IFlowNonCoverageEntry[] = [];

  for (const entry of catalog) {
    const taskIds = taskIdsByFlow.get(entry.flowId) ?? [];
    if (taskIds.length > 0) {
      reachableFlowIds.push(entry.flowId);
    } else {
      nonCoverage.push({
        flowId: entry.flowId,
        reason: "not exercised against any corpus task",
      });
    }
  }

  return { reachableFlowIds, nonCoverage };
}
