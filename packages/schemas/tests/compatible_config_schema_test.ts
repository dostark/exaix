/**
 * @module CompatibleConfigSchemaTest
 * @path packages/schemas/tests/compatible_config_schema_test.ts
 * @description Verifies Phase 155 presence-preserving compatible provider overrides.
 * @architectural-layer Test
 * @dependencies [@exaix/schemas]
 * @related-files [packages/schemas/src/ai_config.ts, packages/schemas/src/config.ts, packages/schemas/src/input_validation.ts]
 */
import { assertEquals } from "@std/assert";
import {
  AiConfigSchema,
  CompatibleChatConfigSchema,
  CompatibleChatOverrideSchema,
  ConfigSchema,
  ModelConfigSchema,
} from "@exaix/schemas";

Deno.test("[phase155.config] raw overrides preserve omitted fields and profile absence", () => {
  assertEquals(CompatibleChatOverrideSchema.parse({ max_response_bytes: 2048 }), {
    max_response_bytes: 2048,
  });
  assertEquals(CompatibleChatOverrideSchema.parse({}), {});
  assertEquals(CompatibleChatConfigSchema.safeParse({ profile: "local-test" }).success, true);
  assertEquals(CompatibleChatConfigSchema.safeParse({ max_response_bytes: 2048 }).success, false);
});

Deno.test("[phase155.config] global and named model config retain raw compatible fields", () => {
  const global = AiConfigSchema.parse({
    provider: "openai-chat",
    compatible: { profile: "local-test", allow_insecure_loopback: true, max_response_bytes: 1024 * 1024 },
  });
  assertEquals(global.compatible?.allow_insecure_loopback, true);
  assertEquals(global.compatible?.max_response_bytes, 1024 * 1024);

  const model = ModelConfigSchema.parse({
    provider: "openai-chat",
    model: "compat-fixture-v1",
    compatible: { max_response_bytes: 2048 },
  });
  assertEquals(model.compatible, { max_response_bytes: 2048 });

  const config = ConfigSchema.parse({
    system: {},
    ai: { provider: "openai-chat", compatible: { profile: "local-test" } },
    models: {
      limited: { provider: "openai-chat", model: "compat-fixture-v1", compatible: { max_response_bytes: 2048 } },
    },
  });
  assertEquals(config.models.limited.compatible, { max_response_bytes: 2048 });
});
