/**
 * @module ReActLoopUsageReasoningTokensE2eTest
 * @path packages/execution/tests/agents/react_loop_usage_reasoning_tokens_e2e_test.ts
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts]
 * @architectural-layer Services
 * @description Phase 167 Step 12 — RED-first test. IGenerateResult.usage now carries
 * reasoningTokens, but ReActLoopStrategy's accumulator variables and finishLoop's
 * finalResult.usage object literal only read prompt/completion/cache tokens and a predicted
 * cost — reasoning-token data would be silently dropped at this exact leaf-to-trunk assembly
 * point even after IGenerateResult and ChangesetResultSchema are both widened. Verifies a
 * fixture IGenerateResult.usage with reasoningTokens survives the full chain
 * (provider.generate() -> accumulation -> finishLoop) into IChangesetResult.usage, tagged
 * cost_source: "predicted" — mirrors react_loop_usage_cache_tokens_e2e_test.ts's Phase 140a
 * pattern for the same class of bug.
 */

import { assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX } from "@exaix/core";
import type { IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import { createOptions, mockExecutor, type ReActExecutor, testBlueprint } from "../helpers/react_loop_fixtures.ts";

const testContext = {
  trace_id: "trace-66666666-6666-4666-8666-666666666666",
  request_id: "request-1",
  request: "test",
  plan: "test",
  portal: "test",
} satisfies IExecutionContext;

Deno.test("[ReActLoopUsageReasoningTokensE2e] reasoning tokens survive provider.generate() -> accumulation -> finishLoop into IChangesetResult.usage, tagged predicted", async () => {
  const provider: IModelProvider = {
    id: "reasoning-token-mock-provider",
    async generate(): Promise<IGenerateResult> {
      await Promise.resolve();
      return {
        content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Done`,
        usage: {
          promptTokens: 150,
          completionTokens: 2340,
          totalTokens: 2490,
          reasoningTokens: 2048,
        },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0.005,
      };
    },
  };

  const strategy = new ReActLoopStrategy(mockExecutor as ReActExecutor, provider);
  const result = await strategy.execute(testBlueprint, testContext, createOptions("test"));

  assertEquals(result.usage?.reasoning_tokens, 2048);
  assertEquals(result.usage?.cost_source, "predicted");
  // Existing fields remain correct.
  assertEquals(result.usage?.prompt_tokens, 150);
  assertEquals(result.usage?.completion_tokens, 2340);
});
