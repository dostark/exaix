/**
 * @module MemoryStatus
 * @path src/shared/status/memory_status.ts
 * @description Shared type definitions and coercion utilities for memory record status values.
 * @architectural-layer Shared
 * @related-files [src/shared/status/mod.ts, src/shared/status/plan_status.ts]
 */

import { MemoryRecordStatus } from "@exaix/core";
import type { JSONValue } from "../types/json.ts";

export const MemoryStatus = {
  PENDING: MemoryRecordStatus.PENDING,
  APPROVED: MemoryRecordStatus.APPROVED,
  REJECTED: MemoryRecordStatus.REJECTED,
  ARCHIVED: MemoryRecordStatus.ARCHIVED,
} as const;

export type MemoryStatus = MemoryRecordStatus;
export type MemoryStatusType = MemoryStatus;

export const MEMORY_STATUS_VALUES = [
  MemoryStatus.PENDING,
  MemoryStatus.APPROVED,
  MemoryStatus.REJECTED,
  MemoryStatus.ARCHIVED,
] as const;

export function isMemoryStatus(value: JSONValue): value is MemoryStatus {
  return typeof value === "string" && (MEMORY_STATUS_VALUES as readonly string[]).includes(value);
}

export function coerceMemoryStatus(
  value: JSONValue,
  fallback: MemoryStatus = MemoryStatus.PENDING,
): MemoryStatus {
  return isMemoryStatus(value) ? value : fallback;
}
