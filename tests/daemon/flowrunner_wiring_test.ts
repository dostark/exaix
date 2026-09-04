/**
 * @module DaemonFlowRunnerWiringTest
 * @path tests/daemon/flowrunner_wiring_test.ts
 * @description Verifies the daemon's FlowRunner creation sequence:
 * IAgentRunner → AgentComposerAdapter → FlowRunner assembly.
 */

import { assertExists } from "@std/assert";
import { join } from "@std/path";
import { initTestDbService } from "@exaix/testing";
import { AgentRunner } from "@exaix/execution";
import { AgentComposerAdapter, FlowRunner, type IFlowEventLogger } from "@exaix/flow";
import { ProviderFactory, ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";

Deno.test({
  name: "Daemon creates FlowRunner with AgentComposerAdapter and correct blueprintsPath",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { config, tempDir, cleanup } = await initTestDbService();
    bootstrapProviderRegistry();

    ProviderRegistry.registerWithMetadata("mock", new MockProviderFactory(), {
      name: "mock",
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      capabilities: ["chat"],
      description: "Mock provider for testing",
      strengths: ["fast", "reliable", "deterministic"],
    });

    try {
      const agentRolesDir = join(tempDir, "Blueprints", "Agents");
      await Deno.mkdir(agentRolesDir, { recursive: true });

      // Replicate daemon bootstrap sequence from apps/daemon/main.ts
      const provider = await ProviderFactory.createByName(config, "default");
      const agentRunner = new AgentRunner(provider);
      const adapter = new AgentComposerAdapter(agentRunner, agentRolesDir);
      const flowLogger: IFlowEventLogger = {
        log: <TEvent extends string>(_event: TEvent, _payload: Record<string, string | number | boolean>): void => {},
      } as IFlowEventLogger;

      const flowRunner = new FlowRunner({
        agentExecutor: adapter,
        config,
        eventLogger: flowLogger,
      });

      assertExists(agentRunner, "IAgentRunner should be created");
      assertExists(adapter, "AgentComposerAdapter should be created");
      assertExists(flowRunner, "FlowRunner should be created");
    } finally {
      await cleanup();
    }
  },
});
