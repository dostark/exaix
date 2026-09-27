/**
 * @module ProviderFactoryCompatibleConfigTest
 * @path packages/ai/tests/provider_factory_compatible_config_test.ts
 * @description Verifies config inheritance, defaults and pre-create capture rejection for compatible profiles.
 * @architectural-layer Test
 * @dependencies [@exaix/ai, @exaix/schemas]
 * @related-files [packages/ai/src/provider_factory.ts, packages/schemas/src/ai_config.ts]
 */
import { assertEquals, assertRejects } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";
import { withEnv } from "@exaix/testing/helpers/env.ts";
import { ProviderFactory } from "../src/provider_factory.ts";
import { ProviderFactoryError } from "../src/errors.ts";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { AbstractKeyBasedProviderFactory } from "../src/factories/abstract_provider_factory.ts";
import type { IModelProvider, IResolvedProviderOptions } from "../src/types.ts";
import { setProviderRegistryBootstrap } from "../src/provider_factory.ts";
import { ProviderType } from "@exaix/core";
import type { IGenerateResult } from "../src/providers/common.ts";

let createdOptions: IResolvedProviderOptions[];
let factoryCreates: number;

class ObserverFactory extends AbstractKeyBasedProviderFactory {
  constructor() {
    super("unused-test-key");
  }

  override create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    factoryCreates++;
    createdOptions.push(options);
    return Promise.resolve({
      id: `${options.provider}-${options.model}`,
      generate: (_prompt, _options) =>
        Promise.resolve(
          {
            content: "ok",
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            model: options.model,
            provider: options.provider,
          } satisfies IGenerateResult,
        ),
    });
  }
}
const observerFactory = new ObserverFactory();

function registerObserver(): void {
  ProviderRegistry.register(ProviderType.OPENAI_CHAT, observerFactory);
}

async function withObserver<T>(fn: () => Promise<T>): Promise<T> {
  ProviderRegistry.clear();
  createdOptions = [];
  factoryCreates = 0;
  setProviderRegistryBootstrap(registerObserver);
  try {
    return await fn();
  } finally {
    setProviderRegistryBootstrap(undefined);
    ProviderRegistry.clear();
  }
}

const baseConfig = {
  system: {},
  ai: {
    provider: "openai-chat",
    model: "compat-fixture-v1",
    compatible: { profile: "local-test", allow_insecure_loopback: true, max_response_bytes: 1024 * 1024 },
  },
};

Deno.test("[phase155.factory] typed compatible failure cannot fall back to mock", async () => {
  await withObserver(async () => {
    class RejectingFactory extends ObserverFactory {
      override create(): Promise<IModelProvider> {
        return Promise.reject(new ProviderFactoryError("redacted fixture failure", "credential_missing"));
      }
    }
    setProviderRegistryBootstrap(() => ProviderRegistry.register(ProviderType.OPENAI_CHAT, new RejectingFactory()));
    const config = ConfigSchema.parse({
      ...baseConfig,
      models: {
        compatible: { provider: "openai-chat", model: "compat-fixture-v1" },
        fallback: { provider: "mock", model: "test" },
      },
    });
    const error = await assertRejects(
      () =>
        ProviderFactory.createWithFallback(config, { primary: "compatible", fallbacks: ["fallback"], maxRetries: 0 }),
      ProviderFactoryError,
    );
    assertEquals(error.reasonCode, "credential_missing");
  });
});

Deno.test("[phase155.factory] explicit false and mixed providers retain their own configuration", async () => {
  await withObserver(async () => {
    const config = ConfigSchema.parse({
      ...baseConfig,
      models: {
        limited: {
          provider: "openai-chat",
          model: "compat-fixture-v1",
          compatible: { allow_insecure_loopback: false },
        },
        ordinary: { provider: "mock", model: "test" },
        invalid: { provider: "mock", model: "test", compatible: { profile: "local-test" } },
      },
    });
    await ProviderFactory.createByName(config, "limited");
    assertEquals(createdOptions[0].compatible?.allow_insecure_loopback, false);
    assertEquals(ProviderFactory.getProviderInfoByName(config, "ordinary").type, "mock");
    const error = await assertRejects(() => ProviderFactory.createByName(config, "invalid"), ProviderFactoryError);
    assertEquals(error.reasonCode, "profile_mismatch");
  });
});

Deno.test("[phase155.factory] absent compatible registration is terminal before a mock can be created", async () => {
  ProviderRegistry.clear();
  setProviderRegistryBootstrap(() => {});
  try {
    const config = ConfigSchema.parse({
      ...baseConfig,
      models: { selected: { provider: "openai-chat", model: "compat-fixture-v1" } },
    });
    const error = await assertRejects(() => ProviderFactory.createByName(config, "selected"), ProviderFactoryError);
    assertEquals(error.reasonCode, "registration_missing");
  } finally {
    setProviderRegistryBootstrap(undefined);
    ProviderRegistry.clear();
  }
});

Deno.test("[phase155.factory] same-profile defaults are added after partial overrides", async () => {
  await withEnv({
    EXA_LLM_PROVIDER: null,
    EXA_LLM_MODEL: null,
    EXA_LLM_BASE_URL: null,
    EXA_LLM_ENDPOINT: null,
    EXA_LLM_TIMEOUT_MS: null,
  }, async () => {
    await withObserver(async () => {
      const config = ConfigSchema.parse({
        ...baseConfig,
        models: {
          limited: { provider: "openai-chat", model: "compat-fixture-v1", compatible: { max_response_bytes: 2048 } },
        },
      });
      await ProviderFactory.createByName(config, "limited");
      assertEquals(createdOptions[0].compatible?.profile, "local-test");
      assertEquals(createdOptions[0].compatible?.allow_insecure_loopback, true);
      assertEquals(createdOptions[0].compatible?.max_response_bytes, 2048);
      assertEquals(createdOptions[0].compatible?.max_history_bytes, 8 * 1024 * 1024);
    });
  });
});

Deno.test("[phase155.factory] profile switch does not inherit local endpoint or loopback grant", async () => {
  await withEnv({
    EXA_LLM_PROVIDER: null,
    EXA_LLM_MODEL: null,
    EXA_LLM_BASE_URL: null,
    EXA_LLM_ENDPOINT: null,
    EXA_LLM_TIMEOUT_MS: null,
  }, async () => {
    await withObserver(async () => {
      const config = ConfigSchema.parse({
        ...baseConfig,
        models: {
          remote: { provider: "openai-chat", model: "gpt-4.1-mini-2025-04-14", compatible: { profile: "openai" } },
        },
      });
      await ProviderFactory.createByName(config, "remote");
      assertEquals(createdOptions[0].compatible?.profile, "openai");
      assertEquals(createdOptions[0].compatible?.allow_insecure_loopback, false);
      assertEquals(createdOptions[0].compatible?.endpoint, "https://api.openai.com/v1/chat/completions");
      assertEquals(createdOptions[0].compatible?.max_response_bytes, 8 * 1024 * 1024);
    });
  });
});

Deno.test("[phase155.factory] global compatible defaults preserve model and timeout omission until resolution", async () => {
  await withObserver(async () => {
    const config = ConfigSchema.parse({
      system: {},
      ai: { provider: "openai-chat", compatible: { profile: "openai" } },
      ai_timeout: { providers: { "openai-chat": 1234, openai: 9999 } },
    });
    await ProviderFactory.create(config);
    assertEquals(createdOptions[0].model, "gpt-4.1-mini-2025-04-14");
    assertEquals(createdOptions[0].timeoutMs, 1234);
  });
});

Deno.test("[phase155.factory] omitted model on a profile switch uses the new qualified defaults", async () => {
  await withObserver(async () => {
    const config = ConfigSchema.parse({
      ...baseConfig,
      models: { remote: { provider: "openai-chat", compatible: { profile: "openai" } } },
    });
    await ProviderFactory.createByName(config, "remote");
    assertEquals(createdOptions[0].model, "gpt-4.1-mini-2025-04-14");
    assertEquals(createdOptions[0].compatible?.endpoint, "https://api.openai.com/v1/chat/completions");
    assertEquals(createdOptions[0].compatible?.allow_insecure_loopback, false);
  });
});

Deno.test("[phase155.factory] named compatible defaults do not inherit another provider's model or endpoint", async () => {
  await withObserver(async () => {
    const config = ConfigSchema.parse({
      system: {},
      ai: { provider: "mock", model: "ordinary-model", base_url: "https://ordinary.fixture.example/v1" },
      ai_timeout: { providers: { "openai-chat": 1234 } },
      models: { remote: { provider: "openai-chat", compatible: { profile: "openai" } } },
    });
    await ProviderFactory.createByName(config, "remote");
    assertEquals(createdOptions[0].model, "gpt-4.1-mini-2025-04-14");
    assertEquals(createdOptions[0].compatible?.endpoint, "https://api.openai.com/v1/chat/completions");
    assertEquals(createdOptions[0].timeoutMs, 1234);
  });
});

Deno.test("[phase155.factory] endpoint environment override reaches final compatible tuple validation", async () => {
  await withEnv({ EXA_LLM_BASE_URL: "https://invalid.fixture.example/v1/chat/completions" }, async () => {
    await withObserver(async () => {
      const config = ConfigSchema.parse({
        ...baseConfig,
        models: { local: { provider: "openai-chat", model: "compat-fixture-v1" } },
      });
      await ProviderFactory.createByName(config, "local");
      assertEquals(createdOptions[0].compatible?.endpoint, "https://invalid.fixture.example/v1/chat/completions");
    });
  });
});

Deno.test("[phase155.factory] missing profile fails before provider construction", async () => {
  await withEnv({
    EXA_LLM_PROVIDER: null,
    EXA_LLM_MODEL: null,
    EXA_LLM_BASE_URL: null,
    EXA_LLM_ENDPOINT: null,
    EXA_LLM_TIMEOUT_MS: null,
  }, async () => {
    await withObserver(async () => {
      const config = ConfigSchema.parse({
        system: {},
        models: { default: { provider: "openai-chat", model: "compat-fixture-v1" } },
      });
      await assertRejects(() => ProviderFactory.createByName(config, "default"), ProviderFactoryError);
      assertEquals(factoryCreates, 0);
    });
  });
});

Deno.test("[phase155.factory] compatible capture is rejected before provider construction", async () => {
  await withEnv({
    EXA_LLM_PROVIDER: null,
    EXA_LLM_MODEL: null,
    EXA_LLM_BASE_URL: null,
    EXA_LLM_ENDPOINT: null,
    EXA_LLM_TIMEOUT_MS: null,
    EXA_CAPTURE_FIXTURES_DIR: "/tmp/phase155-capture-must-not-exist",
  }, async () => {
    await withObserver(async () => {
      const config = ConfigSchema.parse({
        system: {},
        models: {
          default: { provider: "openai-chat", model: "compat-fixture-v1", compatible: { profile: "local-test" } },
        },
      });
      const error = await assertRejects(() => ProviderFactory.createByName(config, "default"), ProviderFactoryError);
      assertEquals(error.reasonCode, "capture_unsupported");
      assertEquals(factoryCreates, 0);
    });
  });
});
