/**
 * @module ProviderRoutingStrategy
 * @path packages/ai/src/routing/provider_routing_strategy.ts
 * @description Edition-separation seam (Phase 115 Step 2): the provider-routing decision
 * (selectProvider / selectProviderForTask) extracted as an injectable strategy. ProviderSelector
 * delegates to an IProviderRoutingStrategy; Solo uses DefaultRoutingStrategy, paid editions inject
 * an advanced strategy through the edition composer. No edition conditional lives in core.
 * @architectural-layer AI
 * @dependencies [packages/ai/src/provider_selector.ts]
 * @related-files [packages/ai/src/provider_selector.ts, packages/ai/src/routing/default_routing_strategy.ts]
 */

import type { ISelectionCriteria } from "../provider_selector.ts";
import type { Config } from "@exaix/schemas";

/** The provider-routing decision, extracted so it can be replaced per edition. */
export interface IProviderRoutingStrategy {
  /** Select the optimal provider for the given criteria. Throws if none is suitable. */
  selectProvider(criteria: ISelectionCriteria): Promise<string>;
  /** Select a provider for a task type using the configuration-driven strategy. */
  selectProviderForTask(config: Config, taskType: string): Promise<string>;
}
