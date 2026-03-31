/**
 * @module MemoryStatus
 * @path src/shared/status/memory_status.ts
 * @description Shared type definitions and coercion utilities for memory record statuses.
 * @architectural-layer Shared
 * * @related-files [src/shared/schemas/memory_bank.ts]
 */
import { MemoryRecordStatus } from "../enums.ts";
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

export function isMemoryStatus(value: unknown): value is MemoryStatus {
  return typeof value === "string" && (MEMORY_STATUS_VALUES as readonly string[]).includes(value);
}

export function coerceMemoryStatus(
  value: unknown,
  fallback: MemoryStatus = MemoryStatus.PENDING,
): MemoryStatus {
  return isMemoryStatus(value) ? value : fallback;
}
