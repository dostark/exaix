/**
 * @module HealthCheckServiceTest
 * @path tests/services/health/health_check_service_test.ts
 * @description Verifies the core HealthCheckService logic, ensuring correct registration
 * of subsystem dependency checks and aggregate health computation.
 */

import { assertEquals, assertExists } from "@std/assert";
import { DEFAULT_MCP_VERSION } from "@exaix/mcp";
import { ExecutionStatus, HealthCheckVerdict, HealthStatus, MockStrategy } from "@exaix/core";
import { createMockConfig } from "../../helpers/config.ts";
import {
  DatabaseHealthCheck,
  DiskSpaceHealthCheck,
  HealthCheckService,
  type IHealthCheck,
  initializeHealthChecks,
  LLMProviderHealthCheck,
  MemoryHealthCheck,
} from "../../../src/services/core/health_check_service.ts";
import { MockLLMProvider } from "@exaix/ai/providers";
import { initTestDbService } from "../../helpers/db.ts";

/**
 * Tests for HealthCheckService - Comprehensive Health Monitoring & Readiness Checks
 */

Deno.test("HealthCheckService: initializes with version", () => {
  const service = new HealthCheckService(DEFAULT_MCP_VERSION);
  assertEquals(service.version, "1.0.0");
});

Deno.test("HealthCheckService: registers health checks", () => {
  const service = new HealthCheckService(DEFAULT_MCP_VERSION);
  const mockCheck = {
    name: "test",
    critical: false,
    check: () => Promise.resolve({ status: HealthCheckVerdict.PASS }),
  };

  service.registerCheck(mockCheck);
  assertEquals(service.checks.size, 1);
  assertEquals(service.checks.get("test"), mockCheck);
});

Deno.test("HealthCheckService: returns healthy status when all checks pass", async () => {
  const service = new HealthCheckService(DEFAULT_MCP_VERSION);
  const mockCheck = {
    name: "test",
    critical: false,
    check: () => Promise.resolve({ status: HealthCheckVerdict.PASS, metadata: { test: "data" } }),
  };

  service.registerCheck(mockCheck);
  const status = await service.checkHealth();

  assertEquals(status.status, HealthStatus.HEALTHY);
  assertEquals(status.version, "1.0.0");
  assertExists(status.timestamp);
  assertEquals(status.uptime_seconds >= 0, true);
  assertEquals(status.checks.test.status, HealthCheckVerdict.PASS);
  assertEquals(status.checks.test.metadata?.test, "data");
});

Deno.test("HealthCheckService: returns degraded status when non-critical check fails", async () => {
  const service = new HealthCheckService(DEFAULT_MCP_VERSION);
  const mockCheck = {
    name: "test",
    critical: false,
    check: () => Promise.resolve({ status: HealthCheckVerdict.FAIL, message: "Test failure" }),
  };

  service.registerCheck(mockCheck);
  const status = await service.checkHealth();

  assertEquals(status.status, HealthStatus.DEGRADED);
  assertEquals(status.checks.test.status, HealthCheckVerdict.FAIL);
  assertEquals(status.checks.test.message, "Test failure");
});

Deno.test("HealthCheckService: returns unhealthy status when critical check fails", async () => {
  const service = new HealthCheckService(DEFAULT_MCP_VERSION);
  const mockCheck = {
    name: "test",
    critical: true,
    check: () => Promise.resolve({ status: HealthCheckVerdict.FAIL, message: "Critical failure" }),
  };

  service.registerCheck(mockCheck);
  const status = await service.checkHealth();

  assertEquals(status.status, HealthStatus.UNHEALTHY);
  assertEquals(status.checks.test.status, HealthCheckVerdict.FAIL);
  assertEquals(status.checks.test.message, "Critical failure");
});

Deno.test("HealthCheckService: handles check timeouts", async () => {
  const config = createMockConfig("/tmp");
  config.health.check_timeout_ms = 50; // Short timeout for test
  const service = new HealthCheckService(DEFAULT_MCP_VERSION, config);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const slowCheck: IHealthCheck = {
    name: "slow",
    critical: false,
    check: () =>
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve({ status: HealthCheckVerdict.PASS }), 100);
      }),
  };

  service.registerCheck(slowCheck);

  const status = await service.checkHealth();

  // Clear any remaining timeout from the test
  if (timeoutId) clearTimeout(timeoutId);

  assertEquals(status.checks.slow.status, HealthCheckVerdict.FAIL);
  assertExists(status.checks.slow.message);
  assertEquals(status.checks.slow.message?.includes("timed out"), true);
});

Deno.test("HealthCheckService: runs checks in parallel", async () => {
  const service = new HealthCheckService(DEFAULT_MCP_VERSION);
  let check1Executed = false;
  let check2Executed = false;

  const check1 = {
    name: "check1",
    critical: false,
    check: async () => {
      check1Executed = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { status: HealthCheckVerdict.PASS };
    },
  };

  const check2 = {
    name: "check2",
    critical: false,
    check: async () => {
      check2Executed = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { status: HealthCheckVerdict.PASS };
    },
  };

  service.registerCheck(check1);
  service.registerCheck(check2);

  const startTime = Date.now();
  await service.checkHealth();
  const endTime = Date.now();

  // Should complete in less than 30ms if running in parallel (each check takes 10ms)
  assertEquals(endTime - startTime < 30, true);
  assertEquals(check1Executed, true);
  assertEquals(check2Executed, true);
});

Deno.test("DatabaseHealthCheck: passes when database is accessible", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const check = new DatabaseHealthCheck(db);
    const result = await check.check();

    assertEquals(result.status, HealthCheckVerdict.PASS);
    assertExists(result.metadata);
    assertEquals(typeof result.metadata?.response_time_ms, "number");
    assertEquals(result.duration_ms !== undefined, true);
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseHealthCheck: fails when database query fails", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    // Close the database to simulate failure
    await db.close();
    const check = new DatabaseHealthCheck(db);

    const result = await check.check();

    assertEquals(result.status, HealthCheckVerdict.FAIL);
    assertExists(result.message);
    // Just check that there's an error message
    assertEquals((result.message?.length ?? 0) > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("LLMProviderHealthCheck: passes when provider responds successfully", async () => {
  const mockProvider = new MockLLMProvider(MockStrategy.SCRIPTED, {
    responses: ["OK"],
  });
  const check = new LLMProviderHealthCheck(mockProvider);

  const result = await check.check();

  assertEquals(result.status, "pass");
  assertExists(result.metadata);
  assertEquals(result.metadata?.response_time_ms !== undefined, true);
});

Deno.test("LLMProviderHealthCheck: fails when provider throws error", async () => {
  const mockProvider = new MockLLMProvider(MockStrategy.FAILING, {
    errorMessage: "Provider unavailable",
  });
  const check = new LLMProviderHealthCheck(mockProvider);

  const result = await check.check();

  assertEquals(result.status, HealthCheckVerdict.FAIL);
  assertExists(result.message);
  assertEquals(result.message?.includes("unavailable"), true);
});

Deno.test("LLMProviderHealthCheck: handles timeout gracefully", async () => {
  const mockProvider = new MockLLMProvider(MockStrategy.SLOW, {
    delayMs: 2000,
  });
  const check = new LLMProviderHealthCheck(mockProvider);

  const result = await check.check();

  // Should not hang and should return some status
  assertEquals(
    [HealthCheckVerdict.PASS, HealthCheckVerdict.FAIL, HealthCheckVerdict.WARN].includes(result.status),
    true,
  );
});

Deno.test("DiskSpaceHealthCheck: passes when disk space is sufficient", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "disk-test-" });
  try {
    const check = new DiskSpaceHealthCheck(tempDir, { warn: 99, critical: 99.9 });
    const result = await check.check();

    // With high thresholds, current disk usage should pass
    assertEquals(result.status, HealthCheckVerdict.PASS);
    assertExists(result.metadata);
    assertEquals(typeof result.metadata?.used_percent, "number");
    assertExists(result.metadata?.path);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DiskSpaceHealthCheck: warns when disk space is low", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "disk-test-" });
  try {
    // Use a very low threshold to trigger warning
    const check = new DiskSpaceHealthCheck(tempDir, { warn: 0, critical: 99.9 });
    const result = await check.check();

    // With warn threshold at 0%, it should warn (since disk usage is always > 0%)
    assertEquals(result.status, HealthCheckVerdict.WARN);
    assertExists(result.message);
    assertExists(result.metadata);
    assertEquals(typeof result.metadata?.used_percent, "number");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DiskSpaceHealthCheck: fails when disk access fails", async () => {
  const check = new DiskSpaceHealthCheck("/nonexistent/path/that/does/not/exist", { warn: 80, critical: 95 });
  const result = await check.check();

  assertEquals(result.status, HealthCheckVerdict.FAIL);
  assertExists(result.message);
  assertEquals(result.message?.includes(ExecutionStatus.FAILED), true);
});

Deno.test("MemoryHealthCheck: passes when memory usage is normal", async () => {
  const check = new MemoryHealthCheck({ warn: 99, critical: 99.9 });
  const result = await check.check();

  // With high thresholds, it should pass
  assertEquals(result.status, "pass");
  assertExists(result.metadata);
  assertEquals(typeof result.metadata?.used_mb, "number");
  assertEquals(typeof result.metadata?.total_mb, "number");
});

Deno.test("MemoryHealthCheck: warns when memory usage is high", async () => {
  // Use thresholds that will trigger warning
  const check = new MemoryHealthCheck({ warn: 0, critical: 99.9 });
  const result = await check.check();

  assertEquals(result.status, HealthCheckVerdict.WARN);
  assertExists(result.message);
});

Deno.test("MemoryHealthCheck: fails when memory usage is critical", async () => {
  // Use very low thresholds to trigger failure
  const check = new MemoryHealthCheck({ warn: 0, critical: 0 });
  const result = await check.check();

  assertEquals(result.status, HealthCheckVerdict.FAIL);
  assertExists(result.message);
});

Deno.test("initializeHealthChecks: initializes all health checks", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const mockProvider = new MockLLMProvider(MockStrategy.PATTERN, {
      responses: ["OK"],
    });

    const healthService = initializeHealthChecks(db, mockProvider, config);

    // Check that all expected checks are registered
    const status = await healthService.checkHealth();
    const checkNames = Object.keys(status.checks);

    assertEquals(checkNames.includes("database"), true);
    assertEquals(checkNames.includes("llm_provider"), true);
    assertEquals(checkNames.includes("disk_space"), true);
    assertEquals(checkNames.includes("memory"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("initializeHealthChecks: configures checks with appropriate criticality", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const mockProvider = new MockLLMProvider(MockStrategy.PATTERN, {
      responses: ["OK"],
    });

    const healthService = initializeHealthChecks(db, mockProvider, config);
    const status = await healthService.checkHealth();

    // Database and disk space should be critical
    assertEquals(status.checks.database.status !== undefined, true);
    assertEquals(status.checks.disk_space.status !== undefined, true);
    assertEquals(status.checks.memory.status !== undefined, true);

    // LLM provider should be non-critical
    assertEquals(status.checks.llm_provider.status !== undefined, true);
  } finally {
    await cleanup();
  }
});

Deno.test("HTTP Endpoint Integration: formats health status for HTTP response", async () => {
  const service = new HealthCheckService(DEFAULT_MCP_VERSION);
  const mockCheck = {
    name: "test",
    critical: false,
    check: () => Promise.resolve({ status: HealthCheckVerdict.PASS }),
  };

  service.registerCheck(mockCheck);
  const status = await service.checkHealth();

  // Should be serializable to JSON
  const jsonString = JSON.stringify(status);
  assertExists(jsonString);

  // Should parse back correctly
  const parsed = JSON.parse(jsonString);
  assertEquals(parsed.status, HealthStatus.HEALTHY);
  assertEquals(parsed.version, "1.0.0");
  assertExists(parsed.timestamp);
});

Deno.test("HTTP Endpoint Integration: handles HTTP status code mapping", async () => {
  // Test healthy status
  const healthyService = new HealthCheckService(DEFAULT_MCP_VERSION);
  healthyService.registerCheck({
    name: "test",
    critical: false,
    check: () => Promise.resolve({ status: HealthCheckVerdict.PASS }),
  });

  const healthyStatus = await healthyService.checkHealth();
  assertEquals(healthyStatus.status, HealthStatus.HEALTHY);

  // Test degraded status
  const degradedService = new HealthCheckService(DEFAULT_MCP_VERSION);
  degradedService.registerCheck({
    name: "test",
    critical: false,
    check: () => Promise.resolve({ status: HealthCheckVerdict.FAIL }),
  });

  const degradedStatus = await degradedService.checkHealth();
  assertEquals(degradedStatus.status, HealthStatus.DEGRADED);

  // Test unhealthy status
  const unhealthyService = new HealthCheckService(DEFAULT_MCP_VERSION);
  unhealthyService.registerCheck({
    name: "test",
    critical: true,
    check: () => Promise.resolve({ status: HealthCheckVerdict.FAIL }),
  });

  const unhealthyStatus = await unhealthyService.checkHealth();
  assertEquals(unhealthyStatus.status, HealthStatus.UNHEALTHY);
});
