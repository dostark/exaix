/**
 * @module OtelConfigTest
 * @path packages/schemas/tests/otel_config_test.ts
 * @description Verifies bounded OTLP snapshot-export configuration defaults and validation.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/schemas]
 * @related-files [packages/schemas/src/config.ts]
 */

import { assertEquals, assertFalse } from "@std/assert";
import { ExaPathDefaults, LogLevel } from "@exaix/core";
import { ConfigSchema, OtelExportConfigSchema } from "@exaix/schemas";

Deno.test("OTel export configuration applies safe snapshot defaults", () => {
  assertEquals(OtelExportConfigSchema.parse({}), {
    endpoint: "http://127.0.0.1:4318/v1/traces",
    protocol: "http/json",
    timeout_ms: 10_000,
    max_request_bytes: 4_194_304,
    max_response_bytes: 4_194_304,
    headers_env: "OTEL_EXPORTER_OTLP_HEADERS",
  });
});

Deno.test("legacy configuration gains the complete OTel export defaults", () => {
  const parsed = ConfigSchema.parse({
    system: { root: "/tmp/exa-test", log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
  });
  assertEquals(parsed.otel_export, OtelExportConfigSchema.parse({}));
});

Deno.test("OTel export configuration rejects malformed and unbounded values", () => {
  const invalid = [
    { endpoint: "collector" },
    { protocol: "grpc" },
    { timeout_ms: 0 },
    { max_request_bytes: 0 },
    { max_response_bytes: -1 },
    { headers_env: "bad-name" },
  ];
  for (const candidate of invalid) {
    assertFalse(OtelExportConfigSchema.safeParse(candidate).success);
  }
});

Deno.test("OTel export configuration rejects a max_request_bytes above the structural OTLP ceiling", () => {
  // The structural ceiling (exaix-team/packages/otel-export/src/types.ts:MAX_OTLP_REQUEST_BYTES)
  // is enforced unconditionally at snapshot-assembly time; a configured value above it can never
  // have an observable effect, so the schema must reject it rather than silently accepting a no-op.
  assertFalse(OtelExportConfigSchema.safeParse({ max_request_bytes: 4_194_304 + 1 }).success);
  assertEquals(OtelExportConfigSchema.safeParse({ max_request_bytes: 4_194_304 }).success, true);
});
