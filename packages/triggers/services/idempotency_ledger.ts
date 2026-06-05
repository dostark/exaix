/**
 * @module InMemoryIdempotencyLedger
 * @path packages/triggers/services/idempotency_ledger.ts
 * @architectural-layer Triggers
 * @dependencies ["@exaix/core/triggers"]
 * @related-files []
 * @ungrounded
 * @description In-memory implementation of IIdempotencyLedger for testing and
 * local-first Solo mode. Production deployments should swap for a SQLite-backed
 * implementation with 30-day TTL and periodic GC.
 */

import type { IIdempotencyLedger } from "@exaix/core/triggers";

interface IRecord {
  keyHash: string;
  triggerId: string;
  accepted: boolean;
  createdAt: number;
}

export class InMemoryIdempotencyLedger implements IIdempotencyLedger {
  private store = new Map<string, IRecord>();

  isDuplicate(keyHash: string): Promise<boolean> {
    return Promise.resolve(this.store.has(keyHash));
  }

  record(keyHash: string, triggerId: string, accepted: boolean): Promise<void> {
    this.store.set(keyHash, { keyHash, triggerId, accepted, createdAt: Date.now() });
    return Promise.resolve();
  }

  /** Test helper: clear all records. */
  clear(): void {
    this.store.clear();
  }
}
