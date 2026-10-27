/**
 * @module ReActLoopStrategyRegistryComputedCostTest
 * @path packages/execution/tests/agents/react_loop_strategy_registry_computed_cost_test.ts
 * @description Phase 140a Step 7 — RED-first test. ReActLoopStrategy's cost_usd was always
 * calculateCost()'s flat, per-provider blended-rate estimate — the SAME rate for every Anthropic
 * model, no input/output split, no cache-tier discount. Verifies ReActLoopStrategy now re-prices
 * its real, already-measured response.usage token counts via computeRegistryPredictedCost's
 * per-model split price (static_overlay.ts), falling back to response.cost_usd unchanged when
 * the model has no overlay entry. cost_source stays "predicted" — unaffected by this step.
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/src/registry_computed_cost.ts]
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "@exaix/execution";
import type { AgentComposer, IAgentFileBlueprint } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ExecutionStrategyName, REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX, SecurityMode } from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";

const testBlueprint = {
  name: "test-agent",
  model: "claude-sonnet-5",
  provider: "anthropic",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const testContext = {
  trace_id: "trace-77777777-7777-4777-8777-777777777777",
  request_id: "request-1",
  request: "test",
  plan: "test",
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

interface IPricedTurn {
  /** The provider id of the mock provider. */
  providerId: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** The cost that the provider itself reports. */
  reportedCostUsd: number;
}

/** Runs one ReAct turn against a mock provider and returns the cost that the strategy logged for it. */
async function loggedCostUsd(turn: IPricedTurn): Promise<number | undefined> {
  let capturedCostUsd: number | undefined;
  const mockExecutor = {
    logAgentOutput: async () => {
      await Promise.resolve();
    },
    validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
    parseAgentResponse: (): IChangesetResult => ({
      branch: "feat/test",
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: "Task completed",
      tool_calls: 0,
      execution_time_ms: 0,
    }),
    logGeneration: async (
      _traceId: string,
      _agentRole: string,
      _model: string,
      _provider: string,
      usage: { costUsd: number },
    ) => {
      await Promise.resolve();
      capturedCostUsd = usage.costUsd;
    },
    toolRegistry: {
      execute: async () => {
        await Promise.resolve();
        return { success: true };
      },
      getTools: () => [],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  };

  const provider: IModelProvider = {
    id: turn.providerId,
    async generate(): Promise<IGenerateResult> {
      await Promise.resolve();
      return {
        content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Done`,
        usage: turn.usage,
        model: turn.model,
        provider: "anthropic",
        cost_usd: turn.reportedCostUsd,
      };
    },
  };

  const strategy = new ReActLoopStrategy(mockExecutor as Partial<AgentComposer> as AgentComposer, provider);
  await strategy.execute({ ...testBlueprint, model: turn.model }, testContext, createOptions("test"));
  return capturedCostUsd;
}

Deno.test("[ReActLoopStrategyRegistryComputedCost] cost_usd for a known model is re-priced from the real per-model split rate, not the old flat rate", async () => {
  // 1M prompt + 1M completion tokens on claude-sonnet-5 ($3/$15 per MTok) = $18 real.
  // The old flat COST_RATE_ANTHROPIC ($0.005/1K on 2M combined tokens) would be $10.
  const cost = await loggedCostUsd({
    providerId: "registry-cost-mock-provider",
    model: "claude-sonnet-5",
    usage: { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 },
    reportedCostUsd: 10, // the OLD flat-rate figure, simulating what performProviderCall used to return
  });

  assertAlmostEquals(cost!, 18);
});

Deno.test("[ReActLoopStrategyRegistryComputedCost] an unknown model falls back to response.cost_usd unchanged (no overlay entry)", async () => {
  const cost = await loggedCostUsd({
    providerId: "registry-cost-mock-provider-unknown",
    model: "some-unlisted-future-model",
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    reportedCostUsd: 0.042,
  });

  assertEquals(cost, 0.042);
});
