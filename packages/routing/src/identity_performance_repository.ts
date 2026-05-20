/**
 * @module IdentityPerformanceRepository
 * @path packages/routing/src/identity_performance_repository.ts
 * @description Aggregates historical routing performance metrics from the activity journal.
 * @architectural-layer Services
 * @related-files [packages/routing/src/routing_policy_service.ts]
 */

import type { IActivityRecord } from "@exaix/core/types";
import type { IDatabaseService } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";

export interface IIdentityPerformanceSnapshot {
  identityId: string;
  version: string;
  successRate: number;
  averageConfidence: number;
  averagePromptTokens: number;
  averageCostUsd: number;
  sampleSize: number;
  lastUsedAt?: string;
  stable: boolean;
}

export interface IIdentityPerformanceRepositoryOptions {
  db: IDatabaseService;
  sampleThreshold?: number;
}

export interface IIdentityPerformanceRepository {
  getPerformanceByCapability(
    capability: string,
    portalName?: string,
  ): Promise<IIdentityPerformanceSnapshot[]>;

  getPerformanceByIdentity(identityId: string): Promise<IIdentityPerformanceSnapshot[]>;
}

interface SnapshotAccumulator {
  identityId: string;
  version: string;
  sampleSize: number;
  successCount: number;
  confidenceSum: number;
  promptTokenSum: number;
  costUsdSum: number;
  lastUsedAt: string;
}

export class IdentityPerformanceRepository implements IIdentityPerformanceRepository {
  private readonly db: IDatabaseService;
  private readonly sampleThreshold: number;

  constructor(options: IIdentityPerformanceRepositoryOptions) {
    this.db = options.db;
    this.sampleThreshold = options.sampleThreshold ?? 5;
  }

  async getPerformanceByCapability(
    capability: string,
    portalName?: string,
  ): Promise<IIdentityPerformanceSnapshot[]> {
    const records = await this.db.queryActivity({ payload: capability, limit: 1000 });
    return this.buildSnapshots(records, capability, portalName);
  }

  async getPerformanceByIdentity(identityId: string): Promise<IIdentityPerformanceSnapshot[]> {
    const records = await this.db.queryActivity({ identityId, limit: 1000 });
    return this.buildSnapshots(records);
  }

  private buildSnapshots(
    records: IActivityRecord[],
    capability?: string,
    portalName?: string,
  ): IIdentityPerformanceSnapshot[] {
    const buckets = new Map<string, SnapshotAccumulator>();

    for (const record of records) {
      if (!record.identity_id) continue;

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
      const key = `${record.identity_id}::${version}`;
      const existing = this.getOrCreateSnapshotAccumulator(buckets, key, record.identity_id, version);

      this.applyRecordToSnapshot(existing, payload, record);
      buckets.set(key, existing);
    }

    return this.formatSnapshots(buckets);
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
    if (typeof payload?.identityVersion === "string") return payload.identityVersion;
    return "unknown";
  }

  private getOrCreateSnapshotAccumulator(
    buckets: Map<string, SnapshotAccumulator>,
    key: string,
    identityId: string,
    version: string,
  ): SnapshotAccumulator {
    return buckets.get(key) ?? {
      identityId,
      version,
      sampleSize: 0,
      successCount: 0,
      confidenceSum: 0,
      promptTokenSum: 0,
      costUsdSum: 0,
      lastUsedAt: "",
    };
  }

  private applyRecordToSnapshot(
    existing: SnapshotAccumulator,
    payload: JsonPayload | null,
    record: IActivityRecord,
  ): void {
    existing.sampleSize += 1;

    if (payload?.success === true) {
      existing.successCount += 1;
    }

    existing.confidenceSum += typeof payload?.confidence === "number" ? payload.confidence : 0;
    existing.promptTokenSum += Number(record.prompt_tokens ?? 0);
    existing.costUsdSum += Number(record.cost_usd ?? 0);

    if (!existing.lastUsedAt || record.timestamp > existing.lastUsedAt) {
      existing.lastUsedAt = record.timestamp;
    }
  }

  private formatSnapshots(buckets: Map<string, SnapshotAccumulator>): IIdentityPerformanceSnapshot[] {
    return Array.from(buckets.values()).map((bucket) => ({
      identityId: bucket.identityId,
      version: bucket.version,
      successRate: bucket.sampleSize > 0 ? bucket.successCount / bucket.sampleSize : 0,
      averageConfidence: bucket.sampleSize > 0 ? bucket.confidenceSum / bucket.sampleSize : 0,
      averagePromptTokens: bucket.sampleSize > 0 ? bucket.promptTokenSum / bucket.sampleSize : 0,
      averageCostUsd: bucket.sampleSize > 0 ? bucket.costUsdSum / bucket.sampleSize : 0,
      sampleSize: bucket.sampleSize,
      lastUsedAt: bucket.lastUsedAt || undefined,
      stable: bucket.sampleSize >= this.sampleThreshold,
    }));
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
