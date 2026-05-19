/**
 * @module AIServiceStubs
 * @path packages/ai/tests/helpers/service_stubs.ts
 * @description Stub implementations for services needed by AI tests.
 */

import type { ICostFilter, ICostTracker, IProviderCostRecord } from "@exaix/core/types";
import type { IProviderHealthChecker } from "../../src/provider_selector.ts";

function stubDailyCost(records: IProviderCostRecord[], _provider?: string): number {
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let total = 0;
  for (const r of records) {
    if (_provider && r.provider !== _provider) continue;
    if (r.timestamp < startOfDay) continue;
    total += r.estimatedCostUsd;
  }
  return total;
}

export function createStubCostTracker(): ICostTracker {
  const records: IProviderCostRecord[] = [];
  return {
    trackGeneration: (
      _provider: string,
      _model: string,
      _usage: { promptTokens: number; completionTokens: number; totalTokens: number },
      _traceId?: string,
      _portal?: string,
    ): Promise<number> => {
      const costPerToken = 0.000002;
      const estimatedCostUsd = _usage.totalTokens * costPerToken;
      records.push({
        id: crypto.randomUUID(),
        provider: _provider,
        model: _model,
        tokens: _usage.totalTokens,
        promptTokens: _usage.promptTokens,
        completionTokens: _usage.completionTokens,
        traceId: _traceId ?? "",
        timestamp: new Date(),
        estimatedCostUsd,
      });
      return Promise.resolve(records.length);
    },
    persistEntry: (_record: IProviderCostRecord): Promise<void> => Promise.resolve(),
    queryByCriteria: (_filter: ICostFilter): Promise<IProviderCostRecord[]> => Promise.resolve(records),
    getTotalCost: (_provider?: string, _model?: string): number => {
      let total = 0;
      for (const r of records) {
        if (_provider && r.provider !== _provider) continue;
        if (_model && r.model !== _model) continue;
        total += r.estimatedCostUsd;
      }
      return total;
    },
    getDailyCost: (_provider?: string): Promise<number> => Promise.resolve(stubDailyCost(records, _provider)),
    flush: (): Promise<void> => Promise.resolve(),
    isWithinBudget: (_provider?: string, _budget?: number): Promise<boolean> => {
      if (_budget === undefined) return Promise.resolve(true);
      return Promise.resolve(stubDailyCost(records, _provider) <= _budget);
    },
  };
}

export function createStubHealthChecker(): IProviderHealthChecker {
  return {
    checkProvider: (_providerName: string): Promise<boolean> => Promise.resolve(true),
  };
}
