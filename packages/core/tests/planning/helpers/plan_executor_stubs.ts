/**
 * @module PlanExecutorTestStubs
 * @path packages/core/tests/planning/helpers/plan_executor_stubs.ts
 * @description Provider, database, and registry stubs shared by the plan executor tests.
 * @architectural-layer Test
 * @related-files [packages/core/tests/planning/plan_executor_model_resolver_test.ts, packages/core/tests/planning/plan_executor_skill_floors_test.ts]
 */

import * as pathBuilders from "@exaix/shared";
import { DefaultRoutingStrategy, ModelResolver, ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import type { Config } from "@exaix/schemas/config.ts";
import { createMockConfig } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { createStubCostTracker, createStubHealthChecker } from "../../../../ai/tests/helpers/service_stubs.ts";
import { PlanExecutor } from "../../../src/planning/mod.ts";

export const stubProvider = {
  id: "stub",
  generate: () =>
    Promise.resolve({
      content: "STATUS: COMPLETE\nSUMMARY: done",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "",
      provider: "",
    }),
};

export const stubDb = {
  prepare: () => {},
  exec: () => {},
  all: () => [],
  close: () => Promise.resolve(),
};

export function registerLocalProvider(name: string): void {
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

type PlanExecutorOptions = NonNullable<ConstructorParameters<typeof PlanExecutor>[5]>;

interface IResolverPlanRun {
  /** Extra frontmatter lines for the `senior-coder` blueprint, for example `model_size: L\n`. */
  blueprintFrontmatter?: string;
  /** Plan executor options on top of the resolver, git off, and report on. Built from the mock config. */
  executorOptions?: (config: Config) => PlanExecutorOptions;
  /** Frontmatter of the executed plan. */
  planFrontmatter?: Record<string, string>;
}

/**
 * Executes a one-step plan with a PlanExecutor that has a real ModelResolver.
 * The run uses a `senior-coder` blueprint and a local mock provider.
 * It returns the logger so a test can assert on its events.
 */
export async function runPlanWithResolver(
  run: IResolverPlanRun = {},
): Promise<{ logger: ReturnType<typeof createMockEventLogger>; config: Config }> {
  ProviderRegistry.clear();
  registerLocalProvider("ollama");
  try {
    const root = await Deno.makeTempDir();
    await Deno.mkdir(pathBuilders.agentsPath(pathBuilders.blueprintsPath(root)), { recursive: true });
    await Deno.writeTextFile(
      pathBuilders.agentsPath(pathBuilders.blueprintsPath(root), "senior-coder.md"),
      `---\nagent_role: senior-coder\nmodel: ""\n${
        run.blueprintFrontmatter ?? ""
      }---\n\nStub agent role for testing.\n`,
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
      { modelResolver: resolver, enableGit: false, generateReport: true, ...run.executorOptions?.(config) },
    );
    await executor.execute(`${root}/plan.md`, {
      trace_id: crypto.randomUUID(),
      request_id: "test-req",
      agent_role: "senior-coder",
      frontmatter: run.planFrontmatter ?? {},
      steps: [{ number: 1, title: "Do nothing", content: "No-op step." }],
    });
    return { logger, config };
  } finally {
    ProviderRegistry.clear();
  }
}
