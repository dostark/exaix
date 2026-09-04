/**
 * @module PlanExecutorModelResolverTest
 * @path packages/core/tests/planning/plan_executor_model_resolver_test.ts
 * @description Phase 135 Step 9 (GAP-C9) — proves PlanExecutor threads a ModelResolver
 *   through IPlanExecutorOptions into AgentOrchestrator's constructor, so
 *   resolveModelFromBlueprint's `if (this.modelResolver)` branch is actually reachable
 *   during real plan execution. Before this fix, createAgentExecutor never passed
 *   modelResolver at all — ModelResolver.resolve() (the only path to best/route/
 *   auto-admit/task_type derivation) was production-dead for every plan execution,
 *   regardless of agent role blueprint content.
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/agent_orchestrator.ts, packages/ai/src/model_resolver.ts]
 */

import { assertEquals } from "@std/assert";
import { createMockConfig } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultRoutingStrategy, ModelResolver, ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { createStubCostTracker, createStubHealthChecker } from "../../../ai/tests/helpers/service_stubs.ts";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { PlanExecutor } from "../../src/planning/mod.ts";

const stubProvider = {
  id: "stub",
  generate: () =>
    Promise.resolve({
      content: "",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "",
      provider: "",
    }),
};

const stubDb = {
  prepare: () => {},
  exec: () => {},
  all: () => [],
  close: () => Promise.resolve(),
};

function registerLocalProvider(name: string): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    contextWindow: 128_000,
  });
}

Deno.test("PlanExecutor accepts modelResolver via IPlanExecutorOptions", () => {
  const config = createMockConfig("/tmp/test", {});
  const logger = createMockEventLogger();
  const resolver = new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    config,
    createStubHealthChecker(),
    logger,
  );

  const executor = new PlanExecutor(
    config,
    stubProvider as never,
    stubDb as never,
    "/tmp/test",
    undefined,
    { modelResolver: resolver, enableGit: false },
  );

  assertEquals(executor instanceof PlanExecutor, true);
});

Deno.test({
  name: "PlanExecutor's AgentOrchestrator calls the injected ModelResolver during step execution (GAP-C9)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    registerLocalProvider("ollama");
    try {
      const root = await Deno.makeTempDir();
      await Deno.mkdir(`${root}/Blueprints/Agents`, { recursive: true });
      await Deno.writeTextFile(
        `${root}/Blueprints/Agents/senior-coder.md`,
        '---\nagent_role: senior-coder\nmodel: ""\n---\n\nStub agent role for testing.\n',
      );
      const config = createMockConfig(root, {});
      const logger = createMockEventLogger();
      const resolver = new ModelResolver(
        new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
        config,
        createStubHealthChecker(),
        logger,
      );

      const executor = new PlanExecutor(
        config,
        stubProvider as never,
        stubDb as never,
        root,
        logger,
        { modelResolver: resolver, enableGit: false, generateReport: true },
      );

      await executor.execute(`${root}/plan.md`, {
        trace_id: crypto.randomUUID(),
        request_id: "test-req",
        agent_role: "senior-coder",
        frontmatter: {},
        steps: [{ number: 1, title: "Do nothing", content: "No-op step." }],
      });

      const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
      assertEquals(
        resolvedEvents.length > 0,
        true,
        "AgentOrchestrator.resolveModelFromBlueprint must call the injected ModelResolver.resolve() " +
          "(observable via the model.resolved event) — not silently skip to the legacy colon-parse fallback",
      );
    } finally {
      ProviderRegistry.clear();
    }
  },
});

Deno.test({
  name: "PlanExecutor threads requestIntent so request model_size overrides the blueprint (GAP-4)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    registerLocalProvider("ollama");
    try {
      const root = await Deno.makeTempDir();
      await Deno.mkdir(`${root}/Blueprints/Agents`, { recursive: true });
      await Deno.writeTextFile(
        `${root}/Blueprints/Agents/senior-coder.md`,
        '---\nagent_role: senior-coder\nmodel: ""\nmodel_size: L\n---\n\nStub agent role for testing.\n',
      );
      const config = createMockConfig(root, {});
      const logger = createMockEventLogger();
      const resolver = new ModelResolver(
        new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
        config,
        createStubHealthChecker(),
        logger,
      );

      const executor = new PlanExecutor(
        config,
        stubProvider as never,
        stubDb as never,
        root,
        logger,
        {
          modelResolver: resolver,
          enableGit: false,
          generateReport: true,
          requestIntent: { model_size: "S" },
        },
      );

      await executor.execute(`${root}/plan.md`, {
        trace_id: crypto.randomUUID(),
        request_id: "test-req",
        agent_role: "senior-coder",
        frontmatter: {},
        steps: [{ number: 1, title: "Do nothing", content: "No-op step." }],
      });

      const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
      const last = resolvedEvents[resolvedEvents.length - 1];
      const intent = last?.payload?.intent as { model_size?: string } | undefined;
      assertEquals(
        intent?.model_size,
        "S",
        "request intent (model_size: S) must override the blueprint's model_size: L in the resolver intake",
      );
    } finally {
      ProviderRegistry.clear();
    }
  },
});
