/**
 * @module IModelRegistry
 * @path packages/core/src/types/i_model_registry.ts
 * @description Phase 132 forward interface for the Phase 134 Model Registry.
 *   Phase 132 ships with DefaultModelRegistry (static config/constants);
 *   Phase 134 swaps in SQLite-backed ModelRegistryService.
 * @architectural-layer Core
 * @dependencies [@exaix/core/enums]
 * @related-files [packages/ai/src/model_resolver.ts]
 */

import type { HealthStatus } from "./enums.ts";

export interface ICapabilityProfile {
  minContextWindow?: number;
  supportsThinking?: boolean;
  supportsEffort?: boolean;
  maxCostPerMillionTokens?: number;
}

export interface ILatencyStats {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sampleCount: number;
  lastUpdated: number;
}

export interface IRateLimitStatus {
  remaining: number;
  maxRpm: number;
  resetAt: number;
}

export interface IModelEntry {
  provider: string;
  model: string;
  capabilities: ICapabilityProfile;
  contextWindow: number;
  costPer1kTokens: number;
}

export type PricingProvenance = "endpoint" | "static" | "remote_static" | "unknown";

export interface IModelPricing {
  provider: string;
  model: string;
  inputPerMtok?: number;
  outputPerMtok?: number;
  provenance: PricingProvenance;
  verifiedAt?: number;
  sourceUrl?: string;
}

export interface IModelRegistry {
  getModelsByCapability(profile: ICapabilityProfile): Promise<IModelEntry[]>;
  getModelCapability(provider: string, model: string): Promise<ICapabilityProfile>;
  getProviderModels(provider: string): Promise<IModelEntry[]>;
  getAllProviders(): Promise<string[]>;
  getModelCost(provider: string, model: string): Promise<number>;
  getContextWindow(provider: string, model: string): Promise<number>;
  recordLatency(provider: string, model: string, latencyMs: number): Promise<void>;
  getLatencyStats(provider: string, model: string): Promise<ILatencyStats>;
  rankByLatency(candidates: Array<{ provider: string; model: string }>): Promise<string[]>;
  recordCall(provider: string): Promise<void>;
  getRateLimit(provider: string): Promise<IRateLimitStatus>;
  getProviderHealth(provider: string): Promise<HealthStatus>;
  getModelPricing(provider: string, model: string): Promise<IModelPricing>;
}

/** The advisory benchmark-score reader `exactl models list --benchmark` uses.
 *  `ModelRegistryService` (Team) satisfies this; Solo/no-reader degrades to "-". */
export interface IBenchmarkReader {
  getBenchmark(provider: string, model: string, benchmark: string): Promise<number | undefined>;
}
