/**
 * @module PlanExecutorModelResolverTest
 * @path packages/core/tests/planning/plan_executor_model_resolver_test.ts
 * @description Phase 135 Step 9 (GAP-C9) — proves PlanExecutor threads a ModelResolver
 *   through IPlanExecutorOptions into AgentComposer's constructor, so
 *   resolveModelFromBlueprint's `if (this.modelResolver)` branch is actually reachable
 *   during real plan execution. Before this fix, createAgentExecutor never passed
 *   modelResolver at all — ModelResolver.resolve() (the only path to best/route/
 *   auto-admit/task_type derivation) was production-dead for every plan execution,
 *   regardless of agent role blueprint content.
 * @architectural-layer Test
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/agent_composer.ts, packages/ai/src/model_resolver.ts]
 */

import { assertEquals } from "@std/assert";
import { createMockConfig } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultRoutingStrategy, ModelResolver, ProviderRegistry } from "@exaix/ai";
import { createStubCostTracker, createStubHealthChecker } from "../../../ai/tests/helpers/service_stubs.ts";
import { PlanExecutor } from "../../src/planning/mod.ts";
import { runPlanWithResolver, stubDb, stubProvider } from "./helpers/plan_executor_stubs.ts";

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
  name: "PlanExecutor's AgentComposer calls the injected ModelResolver during step execution (GAP-C9)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { logger } = await runPlanWithResolver();

    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(
      resolvedEvents.length > 0,
      true,
      "AgentComposer.resolveModelFromBlueprint must call the injected ModelResolver.resolve() " +
        "(observable via the model.resolved event) — not silently skip to the legacy colon-parse fallback",
    );
  },
});

Deno.test({
  name: "PlanExecutor threads requestIntent so request model_size overrides the blueprint (GAP-4)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { logger } = await runPlanWithResolver({
      blueprintFrontmatter: "model_size: L\n",
      executorOptions: () => ({ requestIntent: { model_size: "S" } }),
    });

    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    const last = resolvedEvents[resolvedEvents.length - 1];
    const intent = last?.payload?.intent as { model_size?: string } | undefined;
    assertEquals(
      intent?.model_size,
      "S",
      "request intent (model_size: S) must override the blueprint's model_size: L in the resolver intake",
    );
  },
});

Deno.test({
  name: "PlanExecutor reports its fixed client as the resolved model during step execution",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const fixedClient = { provider: "openai-chat", model: "deepseek-v4-pro" };
    const { logger } = await runPlanWithResolver({
      blueprintFrontmatter: "model_size: M\n",
      executorOptions: () => ({ fixedClient }),
    });

    const resolved = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(resolved.length > 0, true);
    for (const event of resolved) {
      assertEquals(event.payload?.reason, "fixed_client");
      assertEquals(event.payload?.selected, { ...fixedClient, attempt: 1 });
    }
  },
});
