/**
 * @module ReActLoopNativeToolsGateMultiProviderTest
 * @path packages/execution/tests/react_loop_native_tools_gate_multi_provider_test.ts
 * @description Phase 153 Step 1 — proves `ReActLoopStrategy`'s native-tools gate
 * (`options.native_tools_enabled === true && ProviderRegistry.getProviderMetadata(this.provider.id)
 * ?.supportsNativeTools === true`, react_loop_strategy.ts:164-165) is genuinely
 * provider-name-agnostic: it fires for ANY provider id whose registered metadata carries
 * `supportsNativeTools: true`, not just `"anthropic"`. Drives the real gate through
 * `execute()` rather than re-implementing the condition — the gate's first observable
 * effect is calling `executor.toolRegistry.getTools()` (only reached when the gate is
 * true; see react_loop_strategy.ts:169-173), which this test counts.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/execution/src/strategies/react_loop_strategy.ts",
 *   "packages/ai/src/provider_registry.ts",
 *   "packages/ai/tests/providers/provider_registry_native_tools_metadata_test.ts"
 * ]
 */

import { assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "../src/strategies/react_loop_strategy.ts";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import {
  ExecutionStrategyName,
  PricingTier,
  ProviderCostTier,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  SecurityMode,
} from "@exaix/core";
import { makeGenerateResult } from "@exaix/testing";

type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

const NON_ANTHROPIC_PROVIDER_ID = "openai-test";

const testBlueprint: IAgentFileBlueprint = {
  name: "gate-multi-provider-test-agent",
  model: `${NON_ANTHROPIC_PROVIDER_ID}:some-model`,
  provider: NON_ANTHROPIC_PROVIDER_ID,
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "You are a test agent.",
};

const testContext: IExecutionContext = {
  trace_id: "gate-multi-provider-trace-0001",
  request_id: "req-gate-multi-provider-1",
  request: "Run native-tools gate test",
  plan: "Step 1",
  portal: "test",
};

function makeOptions(nativeToolsEnabled: boolean): IAgentExecutionOptions {
  return {
    agent_role: "gate-multi-provider-agent",
    portal: "test",
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 30_000,
    max_tool_calls: 10,
    audit_enabled: false,
    native_tools_enabled: nativeToolsEnabled,
  };
}

/** Executor whose toolRegistry.getTools() is only reachable when the gate evaluates true
 *  (react_loop_strategy.ts:170-171: `this.executor.toolRegistry?.getTools() ?? []`). */
function makeTrackingExecutor(getToolsCalls: { count: number }): ReActExecutor {
  return {
    logAgentOutput: () => Promise.resolve(),
    validateReviewResult: (r: IChangesetResult) => r,
    parseAgentResponse: (_r: string, ctx: IExecutionContext, t: number): IChangesetResult => ({
      branch: "feat/test",
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: ctx.plan,
      tool_calls: 0,
      execution_time_ms: Date.now() - t,
    }),
    logGeneration: () => Promise.resolve(),
    toolRegistry: {
      execute: () => Promise.resolve({ success: true }),
      getTools: () => {
        getToolsCalls.count++;
        return [];
      },
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  };
}

/** Provider that immediately completes the ReAct loop on its first generate() call. */
function makeCompleteProvider(id: string): IModelProvider {
  return {
    id,
    generate: () => Promise.resolve(makeGenerateResult(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`)),
  };
}

Deno.test(
  "[react-loop-native-tools-gate-multi-provider] gate fires for a non-anthropic provider id registered with supportsNativeTools:true",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata(NON_ANTHROPIC_PROVIDER_ID, new MockProviderFactory(), {
      name: NON_ANTHROPIC_PROVIDER_ID,
      description: "Non-Anthropic fixture provider for the multi-provider gate proof",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: [],
      supportsNativeTools: true,
    });

    const getToolsCalls = { count: 0 };
    const strategy = new ReActLoopStrategy(
      makeTrackingExecutor(getToolsCalls),
      makeCompleteProvider(NON_ANTHROPIC_PROVIDER_ID),
    );

    await strategy.execute(testBlueprint, testContext, makeOptions(true));

    assertEquals(getToolsCalls.count, 1);
  },
);

Deno.test(
  "[react-loop-native-tools-gate-multi-provider] gate stays false when native_tools_enabled is true but the provider's metadata omits supportsNativeTools",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata(NON_ANTHROPIC_PROVIDER_ID, new MockProviderFactory(), {
      name: NON_ANTHROPIC_PROVIDER_ID,
      description: "Non-Anthropic fixture provider without native-tools capability",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: [],
      // supportsNativeTools intentionally omitted.
    });

    const getToolsCalls = { count: 0 };
    const strategy = new ReActLoopStrategy(
      makeTrackingExecutor(getToolsCalls),
      makeCompleteProvider(NON_ANTHROPIC_PROVIDER_ID),
    );

    await strategy.execute(testBlueprint, testContext, makeOptions(true));

    assertEquals(getToolsCalls.count, 0);
  },
);

Deno.test(
  "[react-loop-native-tools-gate-multi-provider] production shape: composite provider.id (openai-opus) matches bare-type metadata (openai) with supportsNativeTools",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    // Production provider instances carry a composite id "<type>-<model>" (ProviderFactory
    // generateId), while ProviderRegistry metadata is keyed by the BARE type. The gate must
    // fall back from the composite id to its type prefix, or native tool-calling never fires.
    const BARE_TYPE = "openai";
    const COMPOSITE_ID = "openai-gpt-5-mini";
    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata(BARE_TYPE, new MockProviderFactory(), {
      name: BARE_TYPE,
      description: "Bare-type provider registry entry (production shape)",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: [],
      supportsNativeTools: true,
    });

    const getToolsCalls = { count: 0 };
    const strategy = new ReActLoopStrategy(
      makeTrackingExecutor(getToolsCalls),
      makeCompleteProvider(COMPOSITE_ID),
    );

    await strategy.execute(testBlueprint, testContext, makeOptions(true));

    assertEquals(
      getToolsCalls.count,
      1,
      "composite provider.id must resolve to bare-type metadata, or native tools never enable",
    );
  },
);

Deno.test(
  "[react-loop-native-tools-gate-multi-provider] gate stays false when the capable provider's opt-in flag is unset",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata(NON_ANTHROPIC_PROVIDER_ID, new MockProviderFactory(), {
      name: NON_ANTHROPIC_PROVIDER_ID,
      description: "Non-Anthropic fixture provider with native-tools capability",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: [],
      supportsNativeTools: true,
    });

    const getToolsCalls = { count: 0 };
    const strategy = new ReActLoopStrategy(
      makeTrackingExecutor(getToolsCalls),
      makeCompleteProvider(NON_ANTHROPIC_PROVIDER_ID),
    );

    await strategy.execute(testBlueprint, testContext, makeOptions(false));

    assertEquals(getToolsCalls.count, 0);
  },
);

Deno.test(
  "[react-loop-native-tools-gate-multi-provider] gate does not crash when provider.id is undefined (Step 11 composite-id fallback must stay nil-safe — budget-test regression)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata(NON_ANTHROPIC_PROVIDER_ID, new MockProviderFactory(), {
      name: NON_ANTHROPIC_PROVIDER_ID,
      description: "Non-Anthropic fixture provider with native-tools capability",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: [],
      supportsNativeTools: true,
    });

    const getToolsCalls = { count: 0 };
    // Omit `id` entirely — the budget-test mock provider shape (react_loop_strategy_budget_test.ts).
    const idlessProvider = {
      generate(_prompt: string) {
        return Promise.resolve(makeGenerateResult(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`));
      },
    } as IModelProvider;
    const strategy = new ReActLoopStrategy(makeTrackingExecutor(getToolsCalls), idlessProvider);

    await strategy.execute(testBlueprint, testContext, makeOptions(true));

    // Without an id the metadata lookup is undefined; the gate must simply stay off,
    // not throw a TypeError reading `providerIdForGate.indexOf("-")`.
    assertEquals(getToolsCalls.count, 0);
  },
);
