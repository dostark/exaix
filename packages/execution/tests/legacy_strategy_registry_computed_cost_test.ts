/**
 * @module LegacyStrategyRegistryComputedCostTest
 * @path packages/execution/tests/legacy_strategy_registry_computed_cost_test.ts
 * @description Phase 140a Step 7 — RED-first test. LegacyAgentStrategy's cost_usd was always
 * calculateCost()'s flat, per-provider blended-rate estimate. Verifies LegacyAgentStrategy now
 * re-prices its real, already-measured result.usage token counts via
 * computeRegistryPredictedCost's per-model split price (static_overlay.ts), falling back to
 * result.cost_usd unchanged when the model has no overlay entry. cost_source stays "predicted".
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/legacy_strategy.ts, packages/execution/src/registry_computed_cost.ts]
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { LegacyAgentStrategy } from "@exaix/execution";
import type { AgentComposer, IAgentFileBlueprint } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ExecutionStrategyName, SecurityMode } from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";

const testBlueprint = {
  name: "test-agent",
  model: "claude-sonnet-5",
  provider: "anthropic",
  capabilities: [ExecutionStrategyName.MCP],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const testContext = {
  trace_id: "trace-88888888-8888-4888-8888-888888888888",
  request_id: "request-1",
  request: "test",
  plan: "test plan",
  portal: "test",
} satisfies IExecutionContext;

function createOptions(portal: string): IAgentExecutionOptions {
  return {
    agent_role: "test-agent",
    portal,
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
  };
}

function makeMockExecutor(capture: { costUsd?: number }) {
  return {
    buildExecutionPrompt: async () => {
      await Promise.resolve();
      return "test prompt";
    },
    logGeneration: async (
      _traceId: string,
      _agentRole: string,
      _model: string,
      _provider: string,
      usage: { costUsd: number },
    ) => {
      await Promise.resolve();
      capture.costUsd = usage.costUsd;
    },
    parseAgentResponse: (
      _response: string,
      context: IExecutionContext,
      startTime: number,
    ): IChangesetResult => ({
      branch: `feat/${context.portal}`,
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: context.plan,
      tool_calls: 0,
      execution_time_ms: Date.now() - startTime,
    }),
    validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
    toolRegistry: {
      execute: async () => {
        await Promise.resolve();
        return { success: true };
      },
      getTools: () => [],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
    getPortalConfig: () => undefined,
  };
}

Deno.test("[LegacyStrategyRegistryComputedCost] cost_usd for a known model is re-priced from the real per-model split rate, not the old flat rate", async () => {
  const capture: { costUsd?: number } = {};
  const mockExecutor = makeMockExecutor(capture);

  const provider: IModelProvider = {
    id: "legacy-registry-cost-mock-provider",
    async generate(): Promise<IGenerateResult> {
      await Promise.resolve();
      return {
        content: "no TOML actions here",
        usage: { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 },
        model: "claude-sonnet-5",
        provider: "anthropic",
        cost_usd: 10, // the OLD flat-rate figure
      };
    },
  };

  const strategy = new LegacyAgentStrategy(mockExecutor as Partial<AgentComposer> as AgentComposer, provider);
  const result = await strategy.execute(testBlueprint, testContext, createOptions("test"));

  assertAlmostEquals(capture.costUsd!, 18);
  assertAlmostEquals(result.usage!.cost_usd, 18);
  assertEquals(result.usage!.cost_source, "predicted");
});

Deno.test("[LegacyStrategyRegistryComputedCost] an unknown model falls back to result.cost_usd unchanged (no overlay entry)", async () => {
  const capture: { costUsd?: number } = {};
  const mockExecutor = makeMockExecutor(capture);

  const provider: IModelProvider = {
    id: "legacy-registry-cost-mock-provider-unknown",
    async generate(): Promise<IGenerateResult> {
      await Promise.resolve();
      return {
        content: "no TOML actions here",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: "some-unlisted-future-model",
        provider: "anthropic",
        cost_usd: 0.042,
      };
    },
  };

  const strategy = new LegacyAgentStrategy(mockExecutor as Partial<AgentComposer> as AgentComposer, provider);
  const result = await strategy.execute(
    { ...testBlueprint, model: "some-unlisted-future-model" },
    testContext,
    createOptions("test"),
  );

  assertEquals(capture.costUsd, 0.042);
  assertEquals(result.usage!.cost_usd, 0.042);
});
