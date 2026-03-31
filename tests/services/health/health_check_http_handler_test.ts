/**
 * @module HealthCheckHTTPHandlerTest
 * @path tests/services/health/health_check_http_handler_test.ts
 * @description Verifies the HTTP delivery layer for system health, ensuring correct status
 * codes (200/503) and JSON payloads for external monitoring tools.
 */

import { assertEquals, assertExists } from "@std/assert";
import { handleHealthCheck, HealthCheckService } from "../../../src/services/core/health_check_service.ts";
import { HealthStatus } from "../../../src/shared/enums.ts";

Deno.test("handleHealthCheck: returns 200 with JSON body and response time header", async () => {
  const health = {
    checkHealth: () =>
      Promise.resolve({
        status: HealthStatus.HEALTHY,
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        uptime_seconds: 1,
        checks: {},
      }),
  } as Partial<HealthCheckService> as HealthCheckService;

  const res = await handleHealthCheck(new Request("http://localhost/health"), health);

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/json");
  assertEquals(res.headers.get("Cache-Control"), "no-cache");
  assertExists(res.headers.get("X-Response-Time-ms"));

  const body = await res.json();
  assertEquals(body.status, HealthStatus.HEALTHY);
});

Deno.test("handleHealthCheck: returns 503 when health is unhealthy", async () => {
  const health = {
    checkHealth: () =>
      Promise.resolve({
        status: HealthStatus.UNHEALTHY,
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        uptime_seconds: 1,
        checks: {},
      }),
  } as Partial<HealthCheckService> as HealthCheckService;

  const res = await handleHealthCheck(new Request("http://localhost/health"), health);

  assertEquals(res.status, 503);
});

Deno.test("handleHealthCheck: returns 503 JSON when checkHealth throws", async () => {
  const health = {
    checkHealth: () => {
      throw new Error("boom");
    },
  } as Partial<HealthCheckService> as HealthCheckService;

  const res = await handleHealthCheck(new Request("http://localhost/health"), health);

  assertEquals(res.status, 503);
  assertEquals(res.headers.get("Content-Type"), "application/json");

  const body = await res.json();
  assertEquals(body.status, HealthStatus.UNHEALTHY);
  assertEquals(body.error, "boom");
});
