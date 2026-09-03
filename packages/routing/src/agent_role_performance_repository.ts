/**
 * @module AgentRolePerformanceRepository
 * @path packages/routing/src/agent_role_performance_repository.ts
 * @description Aggregates historical routing performance metrics from the activity journal.
 * @architectural-layer Services
 * @related-files [packages/routing/src/routing_policy_service.ts]
 */

import type { IActivityRecord, IJournalFilterOptions } from "@exaix/core/types";
import type { IDatabaseService } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

export interface IAgentRolePerformanceSnapshot {
  agentRole: string;
  version: string;
  successRate: number;
  averageConfidence: number;
  averagePromptTokens: number;
  averageCostUsd: number;
  sampleSize: number;
  lastUsedAt?: string;
  stable: boolean;
  weightedScore?: number;
}

export interface IBuildSnapshotOptions {
  maxAgeMs?: number;
}

export interface IAgentRolePerformanceRepositoryOptions {
  db: IDatabaseService;
  sampleThreshold?: number;
}

export interface IAgentRolePerformanceRepository {
  getPerformanceByCapability(
    capability: string,
    portalName?: string,
    options?: IBuildSnapshotOptions,
  ): Promise<IAgentRolePerformanceSnapshot[]>;

  getPerformanceByAgentRole(
    agentRole: string,
    options?: IBuildSnapshotOptions,
  ): Promise<IAgentRolePerformanceSnapshot[]>;
}

const DECAY_FACTOR = 2.0;

interface SnapshotAccumulator {
  agentRole: string;
  version: string;
  sampleSize: number;
  successCount: number;
  confidenceSum: number;
  promptTokenSum: number;
  costUsdSum: number;
  lastUsedAt: string;
  weightedSuccessCount: number;
  weightedConfidenceSum: number;
  totalWeight: number;
}

export class AgentRolePerformanceRepository implements IAgentRolePerformanceRepository {
  private readonly db: IDatabaseService;
  private readonly sampleThreshold: number;

  constructor(options: IAgentRolePerformanceRepositoryOptions) {
    this.db = options.db;
    this.sampleThreshold = options.sampleThreshold ?? 5;
  }

  async getPerformanceByCapability(
    capability: string,
    portalName?: Opt<string, Reason.QueryFilter>,
    options?: Opt<IBuildSnapshotOptions, Reason.QueryFilter>,
  ): Promise<IAgentRolePerformanceSnapshot[]> {
    const filter: IJournalFilterOptions = { payload: capability, limit: 1000 };
    if (options?.maxAgeMs) {
      filter.since = new Date(Date.now() - options.maxAgeMs).toISOString();
    }
    const records = await this.db.queryActivity(filter);
    return this.buildSnapshots(records, capability, portalName, options);
  }

  async getPerformanceByAgentRole(
    agentRole: string,
    options?: Opt<IBuildSnapshotOptions, Reason.QueryFilter>,
  ): Promise<IAgentRolePerformanceSnapshot[]> {
    const filter: IJournalFilterOptions = { agentRole, limit: 1000 };
    if (options?.maxAgeMs) {
      filter.since = new Date(Date.now() - options.maxAgeMs).toISOString();
    }
    const records = await this.db.queryActivity(filter);
    return this.buildSnapshots(records, undefined, undefined, options);
  }

  private buildSnapshots(
    records: IActivityRecord[],
    capability?: Opt<string, Reason.QueryFilter>,
    portalName?: Opt<string, Reason.QueryFilter>,
    options?: Opt<IBuildSnapshotOptions, Reason.QueryFilter>,
  ): IAgentRolePerformanceSnapshot[] {
    const buckets = new Map<string, SnapshotAccumulator>();
    const now = Date.now();
    const maxAgeMs = options?.maxAgeMs ?? 0;

    for (const record of records) {
      if (!record.agent_role) continue;

      const ageMs = Math.max(0, now - new Date(record.timestamp).getTime());
      if (maxAgeMs > 0 && ageMs > maxAgeMs) continue;

      const payload = this.safeParsePayload(record.payload);
      const capabilities = this.extractCapabilities(payload);
      if (capability && !capabilities.includes(capability)) {
        continue;
      }

      const portal = this.extractPortal(payload);
      if (portalName && portal !== portalName) {
        continue;
      }

      const version = this.extractVersion(payload);
      const key = `${record.agent_role}::${version}`;
      const existing = this.getOrCreateSnapshotAccumulator(buckets, key, record.agent_role, version);

      const recencyWeight = maxAgeMs > 0 ? Math.exp(-(ageMs / maxAgeMs) * DECAY_FACTOR) : 1;

      this.applyRecordToSnapshot(existing, payload, record, recencyWeight);
      buckets.set(key, existing);
    }

    return this.formatSnapshots(buckets, maxAgeMs > 0);
  }

  private extractCapabilities(payload: JsonPayload | null): string[] {
    if (!Array.isArray(payload?.capabilities)) return [];
    return (payload.capabilities as JSONValue[]).filter((value): value is string => typeof value === "string");
  }

  private extractPortal(payload: JsonPayload | null): string | undefined {
    if (typeof payload?.portal === "string") return payload.portal;
    if (typeof payload?.portalName === "string") return payload.portalName;
    return undefined;
  }

  private extractVersion(payload: JsonPayload | null): string {
    if (typeof payload?.version === "string") return payload.version;
    if (typeof payload?.agentRoleVersion === "string") return payload.agentRoleVersion;
    return "unknown";
  }

  private getOrCreateSnapshotAccumulator(
    buckets: Map<string, SnapshotAccumulator>,
    key: string,
    agentRole: string,
    version: string,
  ): SnapshotAccumulator {
    return buckets.get(key) ?? {
      agentRole,
      version,
      sampleSize: 0,
      successCount: 0,
      confidenceSum: 0,
      promptTokenSum: 0,
      costUsdSum: 0,
      lastUsedAt: "",
      weightedSuccessCount: 0,
      weightedConfidenceSum: 0,
      totalWeight: 0,
    };
  }

  private applyRecordToSnapshot(
    existing: SnapshotAccumulator,
    payload: JsonPayload | null,
    record: IActivityRecord,
    recencyWeight: number,
  ): void {
    existing.sampleSize += 1;
    existing.totalWeight += recencyWeight;

    if (payload?.success === true) {
      existing.successCount += 1;
      existing.weightedSuccessCount += recencyWeight;
    }

    const confidence = typeof payload?.confidence === "number" ? payload.confidence : 0;
    existing.confidenceSum += confidence;
    existing.weightedConfidenceSum += confidence * recencyWeight;
    existing.promptTokenSum += Number(record.prompt_tokens ?? 0);
    existing.costUsdSum += Number(record.cost_usd ?? 0);

    if (!existing.lastUsedAt || record.timestamp > existing.lastUsedAt) {
      existing.lastUsedAt = record.timestamp;
    }
  }

  private formatSnapshots(
    buckets: Map<string, SnapshotAccumulator>,
    hasWeighting: boolean,
  ): IAgentRolePerformanceSnapshot[] {
    return Array.from(buckets.values()).map((bucket) => {
      const totalWeight = bucket.totalWeight || 1;
      const weightedSuccessRate = bucket.sampleSize > 0 ? bucket.weightedSuccessCount / totalWeight : 0;
      const weightedAvgConfidence = bucket.sampleSize > 0 ? bucket.weightedConfidenceSum / totalWeight : 0;
      return {
        agentRole: bucket.agentRole,
        version: bucket.version,
        successRate: hasWeighting ? weightedSuccessRate : bucket.successCount / (bucket.sampleSize || 1),
        averageConfidence: hasWeighting ? weightedAvgConfidence : bucket.confidenceSum / (bucket.sampleSize || 1),
        averagePromptTokens: bucket.sampleSize > 0 ? bucket.promptTokenSum / bucket.sampleSize : 0,
        averageCostUsd: bucket.sampleSize > 0 ? bucket.costUsdSum / bucket.sampleSize : 0,
        sampleSize: bucket.sampleSize,
        lastUsedAt: bucket.lastUsedAt || undefined,
        stable: bucket.sampleSize >= this.sampleThreshold,
        weightedScore: hasWeighting ? weightedSuccessRate : undefined,
      };
    });
  }

  private safeParsePayload(payload: string): JsonPayload | null {
    try {
      return JSON.parse(payload) as JsonPayload;
    } catch {
      return null;
    }
  }
}

interface JsonPayload {
  [key: string]: JSONValue;
}
