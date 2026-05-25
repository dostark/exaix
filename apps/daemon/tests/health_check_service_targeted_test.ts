/**
 * @module HealthCheckServiceTest
 * @path apps/daemon/tests/health_check_service_targeted_test.ts
 * @description Targeted tests for HealthCheckService, verifying multi-provider health aggregation,
 * status caching, and configurable alerting thresholds for degraded services.
 */

import { assertEquals } from "@std/assert";
import { HealthCheckService } from "../../../packages/core/src/health/health_check_service.ts";
import { HealthCheckVerdict, HealthStatus } from "@exaix/core";
import { DEFAULT_MCP_VERSION } from "@exaix/mcp";

Deno.test("HealthCheckService.checkProvider: caches results", async () => {
  const svc = new HealthCheckService(DEFAULT_MCP_VERSION);
  let calls = 0;

  svc.registerCheck({
    name: "p",
    critical: true,
    check: () => {
      calls++;
      return Promise.resolve({ status: HealthCheckVerdict.PASS });
    },
  });

  const a = await svc.checkProvider("p");
  const b = await svc.checkProvider("p");

  assertEquals(a, true);
  assertEquals(b, true);
  assertEquals(calls, 1);
});

Deno.test("HealthCheckService.checkHealth: aggregates degraded/unhealthy", async () => {
  const svc = new HealthCheckService(DEFAULT_MCP_VERSION);

  svc.registerCheck({
    name: "warn",
    critical: false,
    check: () => Promise.resolve({ status: HealthCheckVerdict.FAIL, message: "noncritical" }),
  });

  const report1 = await svc.checkHealth();
  assertEquals(report1.status, HealthStatus.DEGRADED);

  svc.registerCheck({
    name: "fail",
    critical: true,
    check: () => Promise.resolve({ status: HealthCheckVerdict.FAIL, message: "critical" }),
  });

  const report2 = await svc.checkHealth();
  assertEquals(report2.status, HealthStatus.UNHEALTHY);
});

Deno.test("HealthCheckService.resultWithThreshold: returns PASS/WARN/FAIL", () => {
  const base = {
    messagePrefix: "Memory",
    unit: "%",
    durationMs: 1,
    metadata: {},
  };

  const pass = HealthCheckService.resultWithThreshold({ warn: 50, critical: 80 }, 10, base);
  const warn = HealthCheckService.resultWithThreshold({ warn: 50, critical: 80 }, 60, base);
  const fail = HealthCheckService.resultWithThreshold({ warn: 50, critical: 80 }, 90, base);

  assertEquals(pass.status, HealthCheckVerdict.PASS);
  assertEquals(warn.status, HealthCheckVerdict.WARN);
  assertEquals(fail.status, HealthCheckVerdict.FAIL);
});
