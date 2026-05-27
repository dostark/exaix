/**
 * @module ProviderHealthMonitorTest
 * @path packages/core/tests/provider_health_monitor_test.ts
 * @description Tests for ProviderHealthMonitor background polling loop.
 * @related-files ["packages/core/src/health/provider_health_monitor.ts"]
 */

import { assertEquals } from "@std/assert";
import { ProviderHealthMonitor, ProviderHealthVerdict } from "../src/health/provider_health_monitor.ts";

class StubHealthCheckService {
  private results = new Map<string, boolean>();

  setResult(name: string, healthy: boolean): void {
    this.results.set(name, healthy);
  }

  checkProvider(name: string): Promise<boolean> {
    return Promise.resolve(this.results.get(name) ?? true);
  }
}

Deno.test("ProviderHealthMonitor: starts and stops without error", () => {
  const stub = new StubHealthCheckService();
  const monitor = new ProviderHealthMonitor(stub as never, ["openai", "ollama"], 60_000);

  monitor.start();
  const statuses = monitor.getProviderStatuses();

  assertEquals(Object.keys(statuses).length, 2);
  assertEquals(statuses.openai.status, ProviderHealthVerdict.UNKNOWN);
  assertEquals(statuses.ollama.status, ProviderHealthVerdict.UNKNOWN);

  monitor.stop();
});

Deno.test("ProviderHealthMonitor: tracks healthy status after poll", async () => {
  const stub = new StubHealthCheckService();
  stub.setResult("openai", true);

  const monitor = new ProviderHealthMonitor(stub as never, ["openai"], 60_000);

  await monitor.pollOnce();

  const statuses = monitor.getProviderStatuses();
  assertEquals(statuses.openai.status, ProviderHealthVerdict.HEALTHY);
  assertEquals(statuses.openai.consecutiveFailures, 0);
});

Deno.test("ProviderHealthMonitor: tracks unhealthy status after poll", async () => {
  const stub = new StubHealthCheckService();
  stub.setResult("openai", false);

  const monitor = new ProviderHealthMonitor(stub as never, ["openai"], 60_000);

  await monitor.pollOnce();

  const statuses = monitor.getProviderStatuses();
  assertEquals(statuses.openai.status, ProviderHealthVerdict.UNHEALTHY);
  assertEquals(statuses.openai.consecutiveFailures, 1);
});

Deno.test("ProviderHealthMonitor: increments consecutiveFailures across polls", async () => {
  const stub = new StubHealthCheckService();
  stub.setResult("openai", false);

  const monitor = new ProviderHealthMonitor(stub as never, ["openai"], 60_000);

  await monitor.pollOnce();
  await monitor.pollOnce();
  await monitor.pollOnce();

  const statuses = monitor.getProviderStatuses();
  assertEquals(statuses.openai.status, ProviderHealthVerdict.UNHEALTHY);
  assertEquals(statuses.openai.consecutiveFailures, 3);
});

Deno.test("ProviderHealthMonitor: resets consecutiveFailures on success", async () => {
  const stub = new StubHealthCheckService();
  const monitor = new ProviderHealthMonitor(stub as never, ["openai"], 60_000);

  stub.setResult("openai", false);
  await monitor.pollOnce();

  stub.setResult("openai", true);
  await monitor.pollOnce();

  const statuses = monitor.getProviderStatuses();
  assertEquals(statuses.openai.status, ProviderHealthVerdict.HEALTHY);
  assertEquals(statuses.openai.consecutiveFailures, 0);
});
