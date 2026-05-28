/**
 * @module TokenizerConfigTest
 * @path packages/schemas/tests/tokenizer_config_test.ts
 * @description Tests for tokenizer config schema in ConfigSchema
 * @architectural-layer Config
 * @dependencies [@exaix/schemas]
 * @related-files [packages/schemas/src/config.ts]
 */

import { assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";

const MINIMAL_CONFIG = {
  system: { root: "/tmp" },
  paths: {},
};

Deno.test("[TokenizerConfig] defaults to 'auto' when omitted", () => {
  const result = ConfigSchema.safeParse(MINIMAL_CONFIG);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.tokenizer.backend, "auto");
  }
});

Deno.test("[TokenizerConfig] accepts 'local' backend", () => {
  const result = ConfigSchema.safeParse({
    ...MINIMAL_CONFIG,
    tokenizer: { backend: "local" },
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.tokenizer.backend, "local");
  }
});

Deno.test("[TokenizerConfig] accepts 'api' backend", () => {
  const result = ConfigSchema.safeParse({
    ...MINIMAL_CONFIG,
    tokenizer: { backend: "api" },
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.tokenizer.backend, "api");
  }
});

Deno.test("[TokenizerConfig] rejects invalid backend", () => {
  const result = ConfigSchema.safeParse({
    ...MINIMAL_CONFIG,
    tokenizer: { backend: "invalid" },
  });
  assertEquals(result.success, false);
});

Deno.test("[PortalKnowledgeConfig] relevance_search_embedding_enabled defaults to false", () => {
  const result = ConfigSchema.safeParse(MINIMAL_CONFIG);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.portal_knowledge?.relevance_search_embedding_enabled, false);
  }
});

Deno.test("[PortalKnowledgeConfig] accepts relevance_search_embedding_enabled = true", () => {
  const result = ConfigSchema.safeParse({
    ...MINIMAL_CONFIG,
    portal_knowledge: { relevance_search_embedding_enabled: true },
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.portal_knowledge?.relevance_search_embedding_enabled, true);
  }
});
