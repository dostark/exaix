/**
 * @module HealthCheckTimeoutsTest
 * @path tests/services/health/health_check_timeouts_test.ts
 * @description Verifies the resilience of the health check system, ensuring that
 * slow agent responses are correctly timed out without hanging the main service.
 */

import { assertEquals } from "@std/assert";
import { HealthCheckService, type IHealthCheck } from "../../../packages/core/src/health/health_check_service.ts";
import { HealthCheckVerdict, HealthStatus } from "@exaix/core";
import { createTestConfig } from "../../../packages/ai/tests/helpers/test_config.ts";
import { DEFAULT_MCP_VERSION } from "@exaix/mcp";

class SlowCheck {
  name = "slow_check";
  critical = true;
  async check() {
    // Delay longer than timeout
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { status: HealthCheckVerdict.PASS };
  }
}

Deno.test("[health] slow check times out and is reported as FAIL", async () => {
  const config = createTestConfig();
  config.health = {
    check_timeout_ms: 50,
    cache_ttl_ms: 10_000,
    memory_warn_percent: 80,
    memory_critical_percent: 95,
  };

  const svc = new HealthCheckService(DEFAULT_MCP_VERSION, config);
  svc.registerCheck(new SlowCheck() as Partial<IHealthCheck> as IHealthCheck);

  const report = await svc.checkHealth();

  assertEquals(report.status, HealthStatus.UNHEALTHY);
  const checkResult = report.checks["slow_check"];
  // Should be marked as FAIL due to timeout
  assertEquals(checkResult.status, HealthCheckVerdict.FAIL);
  // Allow any pending timers in the slow check to complete to avoid test leak detection
  await new Promise((resolve) => setTimeout(resolve, 220));
});
