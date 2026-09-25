/**
 * @module ResolveProviderTypeTest
 * @path packages/ai/tests/resolve_provider_type_test.ts
 * @description Verifies resolveProviderType normalizes compound `<provider>-<model>` ids
 *   (and bare provider ids) to the canonical ProviderType, per GAP-1's longest-prefix
 *   rule, so native-adaptive detection keys on the provider rather than a never-matching
 *   compound id.
 * @architectural-layer AI
 * @related-files [packages/ai/src/effort_resolver.ts]
 */

import { assertEquals } from "@std/assert";
import { ProviderType } from "@exaix/core";
import { resolveProviderType } from "@exaix/ai";

Deno.test("resolveProviderType: compound anthropic model id maps to ANTHROPIC", () => {
  assertEquals(resolveProviderType("anthropic-claude-sonnet-5"), ProviderType.ANTHROPIC);
});

Deno.test("resolveProviderType: claude-cli compound id maps to CLAUDE_CLI, not a claude prefix", () => {
  assertEquals(resolveProviderType("claude-cli-sonnet"), ProviderType.CLAUDE_CLI);
});

Deno.test("resolveProviderType: codex-cli compound id maps to CODEX_CLI", () => {
  assertEquals(resolveProviderType("codex-cli-gpt-5"), ProviderType.CODEX_CLI);
});

Deno.test("resolveProviderType: bare provider id maps to itself", () => {
  assertEquals(resolveProviderType("anthropic"), ProviderType.ANTHROPIC);
});

Deno.test("resolveProviderType: openai-chat beats the shorter openai prefix", () => {
  assertEquals(resolveProviderType("openai-chat-gpt-5"), ProviderType.OPENAI_CHAT);
});

Deno.test("resolveProviderType: unknown id resolves to undefined", () => {
  assertEquals(resolveProviderType("unknown-x"), undefined);
});

Deno.test("resolveProviderType: undefined input resolves to undefined", () => {
  assertEquals(resolveProviderType(undefined), undefined);
});
