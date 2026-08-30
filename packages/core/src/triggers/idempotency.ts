/**
 * @module TriggerIdempotency
 * @path packages/core/src/triggers/idempotency.ts
 * @architectural-layer Core
 * @dependencies []
 * @related-files ["packages/core/src/triggers/schemas.ts"]
 * @description Idempotency-key normalization and validation utilities for the trigger ingestion pipeline.
 */

export const MAX_IDEMPOTENCY_KEY_LENGTH = 1024;

/** Trims an idempotency key; adapters should call this before setting the key on an envelope. */
export function normalizeIdempotencyKey(key: string): string {
  return key.trim();
}

/** True if a normalized (already-trimmed) key satisfies the min/max length constraints. */
export function validateIdempotencyKey(key: string): boolean {
  const trimmed = key.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_IDEMPOTENCY_KEY_LENGTH;
}
