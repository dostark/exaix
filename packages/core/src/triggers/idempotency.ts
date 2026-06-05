/**
 * @module TriggerIdempotency
 * @path packages/core/src/triggers/idempotency.ts
 * @architectural-layer Core
 * @dependencies []
 * @related-files ["packages/core/src/triggers/schemas.ts"]
 * @description Idempotency-key normalization and validation utilities for the trigger ingestion pipeline.
 */

export const MAX_IDEMPOTENCY_KEY_LENGTH = 1024;

/**
 * Normalize an idempotency key by trimming whitespace.
 * Adapters should call this before setting the key on an envelope.
 */
export function normalizeIdempotencyKey(key: string): string {
  return key.trim();
}

/**
 * Validate an idempotency key meets minimum/maximum length constraints.
 * Accepts a normalized (already trimmed) key.
 */
export function validateIdempotencyKey(key: string): boolean {
  const trimmed = key.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_IDEMPOTENCY_KEY_LENGTH;
}
