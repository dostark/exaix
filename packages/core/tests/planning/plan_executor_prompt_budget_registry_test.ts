/**
 * @module PlanExecutorPromptBudgetRegistryTest
 * @path packages/core/tests/planning/plan_executor_prompt_budget_registry_test.ts
 * @description Phase 135 Step 11 (GAP-10, context-window half) — proves PlanExecutor
 *   threads an IModelRegistry through IPlanExecutorOptions into AgentOrchestrator's
 *   internally-constructed PromptBudgetAllocator, so a step's real context-window
 *   resolution reaches production instead of always falling back to the hardcoded
 *   128K default. Before this fix, createAgentExecutor never populated the
 *   allocator's modelRegistry at all — PromptBudgetAllocator._resolveTotalTokens
 *   always took the 128_000 fallback branch regardless of the resolved model's real
 *   context window.
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/agent_orchestrator.ts, packages/core/src/prompt_budget_allocator.ts]
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { createMockConfig } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { createStubHealthChecker } from "../../../ai/tests/helpers/service_stubs.ts";
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

const LARGE_CONTEXT_WINDOW = 1_000_000;
const DEFAULT_FALLBACK_CONTEXT_WINDOW = 128_000;

function registerLargeWindowProvider(name: string): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.HIGH,
    strengths: ["general"],
    contextWindow: LARGE_CONTEXT_WINDOW,
  });
}

Deno.test("PlanExecutor accepts modelRegistry via IPlanExecutorOptions", () => {
  const config = createMockConfig("/tmp/test", {});
  const registry = new DefaultModelRegistry(createStubHealthChecker());

  const executor = new PlanExecutor(
    config,
    stubProvider as never,
    stubDb as never,
    "/tmp/test",
    undefined,
    { modelRegistry: registry, enableGit: false },
  );

  assertEquals(executor instanceof PlanExecutor, true);
});

Deno.test({
  name:
    "PlanExecutor's AgentOrchestrator resolves a non-default context window via the injected IModelRegistry (Step 11, GAP-10 context-window half)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    const providerName = "large-window-provider";
    registerLargeWindowProvider(providerName);
    try {
      const registry = new DefaultModelRegistry(createStubHealthChecker());
      const window = await registry.getContextWindow(providerName, "any-model");
      assertEquals(
        window,
        LARGE_CONTEXT_WINDOW,
        "sanity check: DefaultModelRegistry must resolve the registered provider's real context window",
      );

      const root = await Deno.makeTempDir();
      await Deno.mkdir(`${root}/Blueprints/Agents`, { recursive: true });
      await Deno.writeTextFile(
        `${root}/Blueprints/Agents/senior-coder.md`,
        `---\nidentity_id: senior-coder\nmodel: "${providerName}:any-model"\n---\n\nStub identity for testing.\n`,
      );
      const config = createMockConfig(root, {});
      const logger = createMockEventLogger();

      const executor = new PlanExecutor(
        config,
        stubProvider as never,
        stubDb as never,
        root,
        logger,
        { modelRegistry: registry, enableGit: false, generateReport: true },
      );

      await executor.execute(`${root}/plan.md`, {
        trace_id: crypto.randomUUID(),
        request_id: "test-req",
        identity: "senior-coder",
        frontmatter: {},
        steps: [{ number: 1, title: "Do nothing", content: "No-op step." }],
      });

      const allocatedEvents = logger.events.filter((e) => e.action === "context.budget.allocated");
      assertEquals(
        allocatedEvents.length > 0,
        true,
        "PromptBudgetAllocator.allocate() must run and journal context.budget.allocated during a real plan execution",
      );
      const totalTokens = (allocatedEvents[0].payload as { totalTokens?: number }).totalTokens;
      assertEquals(
        totalTokens,
        LARGE_CONTEXT_WINDOW,
        "PromptBudgetAllocator constructed inside AgentOrchestrator via PlanExecutor must resolve " +
          "the injected registry's real context window, not the hardcoded 128K fallback",
      );
      assertNotEquals(
        totalTokens,
        DEFAULT_FALLBACK_CONTEXT_WINDOW,
        "regression guard: must not silently regress to the pre-Step-11 hardcoded fallback",
      );
    } finally {
      ProviderRegistry.clear();
    }
  },
});
