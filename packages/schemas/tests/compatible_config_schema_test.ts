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

const SELF_HOSTED = {
  profile: "self-hosted",
  endpoint: "https://gpu.internal/v1/chat/completions",
  model: "llama3.1:8b",
};

Deno.test("[phase203.config] the resolved self-hosted config requires both endpoint and model", () => {
  assertEquals(CompatibleChatConfigSchema.safeParse({ profile: "self-hosted" }).success, false);
  assertEquals(
    CompatibleChatConfigSchema.safeParse({ profile: "self-hosted", endpoint: SELF_HOSTED.endpoint }).success,
    false,
  );
  assertEquals(
    CompatibleChatConfigSchema.safeParse({ profile: "self-hosted", model: SELF_HOSTED.model }).success,
    false,
  );
  assertEquals(CompatibleChatConfigSchema.safeParse(SELF_HOSTED).success, true);
});

Deno.test("[phase203.config] the raw override schema accepts self-hosted without endpoint or model", () => {
  assertEquals(CompatibleChatOverrideSchema.parse({ profile: "self-hosted" }), { profile: "self-hosted" });
});

Deno.test("[phase203.config] supports_tool_choice applies to the self-hosted profile only", () => {
  assertEquals(CompatibleChatConfigSchema.safeParse({ ...SELF_HOSTED, supports_tool_choice: true }).success, true);
  assertEquals(CompatibleChatConfigSchema.safeParse({ ...SELF_HOSTED, supports_tool_choice: false }).success, true);
  for (const profile of ["openai", "deepseek", "local-test"] as const) {
    assertEquals(
      CompatibleChatConfigSchema.safeParse({ profile, supports_tool_choice: true }).success,
      false,
      profile,
    );
  }
});

Deno.test("[phase203.config] openai, deepseek and local-test keep their prior behaviour", () => {
  assertEquals(CompatibleChatConfigSchema.safeParse({ profile: "local-test" }).success, true);
  assertEquals(CompatibleChatConfigSchema.safeParse({ profile: "openai" }).success, true);
  assertEquals(CompatibleChatConfigSchema.safeParse({ profile: "deepseek" }).success, true);
  assertEquals(CompatibleChatConfigSchema.safeParse({ profile: "not-a-profile" }).success, false);
  assertEquals(CompatibleChatOverrideSchema.parse({ profile: "local-test", max_response_bytes: 2048 }), {
    profile: "local-test",
    max_response_bytes: 2048,
  });
});
