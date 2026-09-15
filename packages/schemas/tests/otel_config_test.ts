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
