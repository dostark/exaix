/**
 * @module OtelEventSchemaTest
 * @path packages/schemas/tests/otel_event_schema_test.ts
 * @description Verifies strict privacy-safe OTel export lifecycle payload schemas.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/core, @exaix/schemas]
 * @related-files [packages/schemas/src/otel_export.ts, packages/core/src/events/domain_event_types.ts]
 */

import { assertEquals } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import {
  OtelExportCompletedPayloadSchema,
  OtelExportFailedPayloadSchema,
  OtelExportStartedPayloadSchema,
} from "@exaix/schemas";

Deno.test("OTel export lifecycle event schemas validate bounded metadata", () => {
  assertEquals(DomainEventType.OtelExportStarted, "otel.export.started");
  assertEquals(
    OtelExportStartedPayloadSchema.safeParse({
      destination_scheme: "https",
      destination_host: "otel.example",
      destination_port: 443,
      record_count: 2,
    }).success,
    true,
  );
  assertEquals(
    OtelExportCompletedPayloadSchema.safeParse({
      destination_scheme: "https",
      destination_host: "otel.example",
      destination_port: 443,
      record_count: 2,
      span_count: 3,
      duration_ms: 12,
      retry_count: 0,
    }).success,
    true,
  );
  assertEquals(
    OtelExportFailedPayloadSchema.safeParse({
      destination_scheme: "https",
      destination_host: "otel.example",
      destination_port: 443,
      record_count: 2,
      duration_ms: 12,
      error_code: "HTTP_FAILURE",
      retry_count: 1,
    }).success,
    true,
  );
});

Deno.test("[security] OTel export lifecycle payloads reject secrets and raw URLs", () => {
  const unsafe = {
    destination_scheme: "https",
    destination_host: "otel.example",
    destination_port: 443,
    record_count: 2,
    endpoint: "https://user:secret@otel.example/v1/traces?token=secret",
    headers: { authorization: "secret" },
  };
  assertEquals(OtelExportStartedPayloadSchema.safeParse(unsafe).success, false);
});
