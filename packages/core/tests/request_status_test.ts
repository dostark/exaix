/**
 * @module RequestStatusTest
 * @path packages/core/tests/request_status_test.ts
 * @description Tests for the RequestStatus enum and utilities, covering the
 * Phase 47 new clarification lifecycle values (NEEDS_CLARIFICATION, REFINING,
 * ENRICHING) in addition to the existing statuses.
 * @architectural-layer Shared
 * @related-files [packages/core/src/status/request_status.ts]
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import { coerceRequestStatus, isRequestStatus, REQUEST_STATUS_VALUES, RequestStatus } from "@exaix/core";

Deno.test("[RequestStatus] includes all original values", () => {
  assertStrictEquals(RequestStatus.PENDING, "pending");
  assertStrictEquals(RequestStatus.PLANNED, "planned");
  assertStrictEquals(RequestStatus.IN_PROGRESS, "in_progress");
  assertStrictEquals(RequestStatus.COMPLETED, "completed");
  assertStrictEquals(RequestStatus.FAILED, "failed");
  assertStrictEquals(RequestStatus.CANCELLED, "cancelled");
});

Deno.test("[RequestStatus] includes NEEDS_CLARIFICATION", () => {
  assertStrictEquals(RequestStatus.NEEDS_CLARIFICATION, "needs_clarification");
});

Deno.test("[RequestStatus] includes REFINING", () => {
  assertStrictEquals(RequestStatus.REFINING, "refining");
});

Deno.test("[RequestStatus] includes ENRICHING", () => {
  assertStrictEquals(RequestStatus.ENRICHING, "enriching");
});

Deno.test("[REQUEST_STATUS_VALUES] includes all new status values", () => {
  assertEquals(REQUEST_STATUS_VALUES.includes("needs_clarification" as never), true);
  assertEquals(REQUEST_STATUS_VALUES.includes("refining" as never), true);
  assertEquals(REQUEST_STATUS_VALUES.includes("enriching" as never), true);
});

Deno.test("[isRequestStatus] recognises new status values", () => {
  assertEquals(isRequestStatus("needs_clarification"), true);
  assertEquals(isRequestStatus("refining"), true);
  assertEquals(isRequestStatus("enriching"), true);
});

Deno.test("[isRequestStatus] rejects unknown values", () => {
  assertEquals(isRequestStatus("unknown_status"), false);
  assertEquals(isRequestStatus(""), false);
  assertEquals(isRequestStatus(null), false);
});

Deno.test("[coerceRequestStatus] handles new status values", () => {
  assertEquals(coerceRequestStatus("needs_clarification"), "needs_clarification");
  assertEquals(coerceRequestStatus("refining"), "refining");
  assertEquals(coerceRequestStatus("enriching"), "enriching");
});

Deno.test("[coerceRequestStatus] falls back for unknown values", () => {
  assertEquals(coerceRequestStatus("not_a_status"), RequestStatus.PENDING);
  assertEquals(coerceRequestStatus(undefined), RequestStatus.PENDING);
  assertEquals(coerceRequestStatus(null), RequestStatus.PENDING);
});
