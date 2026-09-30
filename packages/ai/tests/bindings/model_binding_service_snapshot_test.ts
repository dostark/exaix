/**
 * @module ModelBindingServiceSnapshotTest
 * @path packages/ai/tests/bindings/model_binding_service_snapshot_test.ts
 * @description Checks immutable config snapshots and aggregated binding rejection.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { ModelBindingService } from "@exaix/ai";
import { ConfigSchema, FlowSchema } from "@exaix/schemas";
import { createMockEventLogger } from "@exaix/testing";

const flow = FlowSchema.parse({
  id: "research",
  name: "Research",
  description: "Check two services",
  steps: [
    { id: "compose", name: "Compose", agent_role: "composer" },
    { id: "explore", name: "Explore", agent_role: "explorer", dependsOn: ["compose"] },
  ],
  output: { from: "explore" },
});
const catalog = {
  models: {
    "mock/alpha": { model_provider: "mock" },
    "mock/beta": { model_provider: "mock" },
  },
  services: {
    alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
    beta: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/beta": "beta" } },
  },
};

Deno.test("run snapshot retains two service choices after the config changes", async () => {
  let config = ConfigSchema.parse({
    system: {},
    paths: {},
    catalog,
    bindings: {
      "flow:research/step:compose": { service: "alpha", model: "mock/alpha" },
      "flow:research/step:explore": { service: "beta", model: "mock/beta" },
    },
  });
  const logger = createMockEventLogger();
  const service = new ModelBindingService({
    configSource: { get: () => config },
    logger,
    probe: { hasKey: () => true, hasOptIn: () => true },
  });
  const snapshot = await service.snapshotForRun(flow, { traceId: crypto.randomUUID() });
  config = ConfigSchema.parse({
    system: {},
    paths: {},
    catalog,
    bindings: { default: { service: "beta", model: "mock/beta" } },
  });
  assertEquals(snapshot.bindings.get("compose")?.kind, "bound");
  assertEquals(snapshot.bindings.get("explore")?.kind, "bound");
  const target = await service.providerFor(snapshot, {
    flowId: flow.id,
    stepId: "compose",
    agentRole: "composer",
    kind: "agent",
    nativeTools: false,
  });
  assertEquals(target?.binding.service, "alpha");
  assertEquals(logger.events.filter((event) => event.action === "binding.resolved").length, 1);
});

Deno.test("preflight rejects invalid service before acquiring any step provider", async () => {
  const config = ConfigSchema.parse({
    system: {},
    paths: {},
    bindings: { default: { service: "missing", model: "mock/alpha" } },
  });
  const logger = createMockEventLogger();
  const service = new ModelBindingService({
    configSource: { get: () => config },
    logger,
    probe: { hasKey: () => true, hasOptIn: () => true },
  });
  const traceId = crypto.randomUUID();
  await assertRejects(() => service.snapshotForRun(flow, { traceId }));
  assertEquals(logger.events.filter((event) => event.action === "binding.rejected").length, 1);
  assertEquals(logger.events.find((event) => event.action === "binding.rejected")?.traceId, traceId);
  assertEquals(logger.events.filter((event) => event.action === "binding.resolved").length, 0);
});
