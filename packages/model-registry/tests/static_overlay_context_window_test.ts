/**
 * @module StaticOverlayContextWindowTest
 * @path packages/model-registry/tests/static_overlay_context_window_test.ts
 * @description The registry gives each current OpenAI and Anthropic model its own window, so a model is not budgeted at its provider default.
 * @architectural-layer Registry
 * @dependencies [@std/assert, @exaix/ai, @exaix/model-registry]
 * @related-files [packages/model-registry/src/static_overlay.ts, packages/model-registry/src/default_model_registry.ts]
 */

import { assertEquals } from "@std/assert";
import type { IProviderHealthChecker } from "@exaix/ai";
import { DefaultModelRegistry } from "@exaix/model-registry";

const healthChecker: IProviderHealthChecker = { checkProvider: () => Promise.resolve(true) };

Deno.test({
  name: "the registry gives current OpenAI and Anthropic models their own context windows",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const registry = new DefaultModelRegistry(healthChecker);
    assertEquals(await registry.getContextWindow("openai", "gpt-5.6-terra"), 1_050_000);
    assertEquals(await registry.getContextWindow("openai", "gpt-5-mini"), 400_000);
    assertEquals(await registry.getContextWindow("anthropic", "claude-opus-5"), 1_000_000);
    assertEquals(await registry.getContextWindow("anthropic", "claude-sonnet-5"), 1_000_000);
  },
});
