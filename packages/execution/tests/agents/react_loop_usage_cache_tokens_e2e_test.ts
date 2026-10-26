/**
 * @module ReActLoopUsageCacheTokensE2eTest
 * @path packages/execution/tests/agents/react_loop_usage_cache_tokens_e2e_test.ts
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts]
 * @architectural-layer Services
 * @description Phase 140a Step 2 — RED-first test. IGenerateResult.usage now carries
 * cacheReadTokens/cacheCreationTokens, but ReActLoopStrategy's accumulator variables and
 * finishLoop's finalResult.usage object literal only read prompt/completion tokens and a
 * predicted cost — cache-token data would be silently dropped at this exact leaf-to-trunk
 * assembly point even after IGenerateResult and ChangesetResultSchema are both widened.
 * Verifies a fixture IGenerateResult.usage with cache tokens survives the full chain
 * (provider.generate() -> accumulation -> finishLoop) into IChangesetResult.usage, tagged
 * cost_source: "predicted" (ReActLoopStrategy's cost_usd is always a calculateCost()
 * estimate, never a reported figure).
 */

import { assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX } from "@exaix/core";
import {
  createOptions,
  mockExecutor,
  type ReActExecutor,
  testBlueprint,
  testContext,
} from "../helpers/react_loop_fixtures.ts";

Deno.test("[ReActLoopUsageCacheTokensE2e] cache tokens survive provider.generate() -> accumulation -> finishLoop into IChangesetResult.usage, tagged predicted", async () => {
  const provider: IModelProvider = {
    id: "cache-token-mock-provider",
    async generate(): Promise<IGenerateResult> {
      await Promise.resolve();
      return {
        content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Done`,
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cacheReadTokens: 20,
          cacheCreationTokens: 80,
        },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0.005,
      };
    },
  };

  const strategy = new ReActLoopStrategy(mockExecutor as ReActExecutor, provider);
  const result = await strategy.execute(testBlueprint, testContext, createOptions("test"));

  assertEquals(result.usage?.cache_read_tokens, 20);
  assertEquals(result.usage?.cache_creation_tokens, 80);
  assertEquals(result.usage?.cost_source, "predicted");
  // Existing fields remain correct.
  assertEquals(result.usage?.prompt_tokens, 100);
  assertEquals(result.usage?.completion_tokens, 50);
});
