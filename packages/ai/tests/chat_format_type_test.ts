/**
 * @module ChatFormatTypeTest
 * @path packages/ai/tests/chat_format_type_test.ts
 * @description Verifies chat_format type scaffolding for Phase 155 Step 1:
 *   ProviderType.OPENAI_CHAT, IModelOptions.chatFormat, IProviderMetadata.chatFormat.
 * @architectural-layer Test
 * @related-files [packages/core/src/types/enums.ts, packages/ai/src/types.ts, packages/ai/src/provider_registry.ts]
 */

import { assertEquals } from "@std/assert";
import { ProviderType } from "@exaix/core";
import type { IModelOptions } from "@exaix/ai/types.ts";

Deno.test("[ChatFormat] ProviderType.OPENAI_CHAT resolves to openai-chat", () => {
  assertEquals(ProviderType.OPENAI_CHAT, "openai-chat");
});

Deno.test("[ChatFormat] IModelOptions accepts chatFormat: openai", () => {
  const opts: IModelOptions = { chatFormat: "openai" };
  assertEquals(opts.chatFormat, "openai");
});

Deno.test("[ChatFormat] IModelOptions accepts chatFormat: anthropic (default)", () => {
  const opts: IModelOptions = { chatFormat: "anthropic" };
  assertEquals(opts.chatFormat, "anthropic");
});

Deno.test("[ChatFormat] IModelOptions accepts chatFormat: native", () => {
  const opts: IModelOptions = { chatFormat: "native" };
  assertEquals(opts.chatFormat, "native");
});
