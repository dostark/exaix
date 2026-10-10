/**
 * @module LiveDeepSeekProvider
 * @path tests/helpers/live_deepseek_provider.ts
 * @description Builds the DeepSeek provider that the live-provider tests call. It goes through the
 *   production OpenAI-compatible factory, so the endpoint, the pinned model and the DEEPSEEK_API_KEY
 *   policy are the ones the daemon uses.
 * @architectural-layer Test
 * @dependencies [@exaix/ai-openai, @exaix/ai, @exaix/core, @exaix/schemas, @exaix/testing]
 * @related-files [packages/ai-openai/src/compatible_factory.ts, packages/testing/src/constants.ts]
 */

import { OpenAICompatibleProviderFactory } from "@exaix/ai-openai";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { OPENAI_COMPATIBLE_PROFILE_DEFAULTS, ProviderType } from "@exaix/core";
import { CompatibleChatConfigSchema } from "@exaix/schemas";
import { DEEPSEEK_PINNED_MODEL } from "@exaix/testing";

const LIVE_DEEPSEEK_TIMEOUT_MS = 60_000;

/** Creates the DeepSeek provider through the compatible factory. Requires DEEPSEEK_API_KEY. */
export async function createLiveDeepSeekProvider(): Promise<IModelProvider> {
  const compatible = CompatibleChatConfigSchema.parse({
    profile: "deepseek",
    endpoint: OPENAI_COMPATIBLE_PROFILE_DEFAULTS.deepseek.endpoint,
    model: DEEPSEEK_PINNED_MODEL,
  });
  return await new OpenAICompatibleProviderFactory().create({
    provider: ProviderType.OPENAI_CHAT,
    model: DEEPSEEK_PINNED_MODEL,
    timeoutMs: LIVE_DEEPSEEK_TIMEOUT_MS,
    compatible,
  });
}
