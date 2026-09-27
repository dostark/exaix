/**
 * @module CompatibleFactoryTest
 * @path packages/ai-openai/tests/compatible_factory_test.ts
 * @description Verifies local-test profile rejection, credential isolation and eager provider construction.
 * @architectural-layer Tests
 * @dependencies [@exaix/ai-openai, @exaix/testing]
 * @related-files [packages/ai-openai/src/compatible_factory.ts]
 */
import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { ProviderFactoryError } from "@exaix/ai/errors.ts";
import type { IResolvedProviderOptions } from "@exaix/ai/types.ts";
import { ProviderType, SecureCredentialStore } from "@exaix/core";
import { ConfigSchema } from "@exaix/schemas";
import { stub } from "@std/testing/mock";
import { withEnv } from "@exaix/testing/helpers/env.ts";
import { OpenAICompatibleProviderFactory } from "../src/compatible_factory.ts";
import { OpenAIProvider } from "../src/openai_provider.ts";

Deno.test("compatible monetary reservation uses verified profile rates and never prices local fixture traffic", async () => {
  let lookups = 0;
  const pricingLookup = {
    getModelPricing: (provider: string, model: string) => {
      lookups++;
      return Promise.resolve({
        provider,
        model,
        inputPerMtok: 2,
        outputPerMtok: 8,
        provenance: "static" as const,
        verifiedAt: 1,
        sourceUrl: "https://fixture.invalid/synthetic-rates",
      });
    },
  };
  const policy = options("local-test", "http://127.0.0.1:4312/v1/chat/completions").compatible!;
  const local = new OpenAIProvider({ apiKey: "fixture-key", compatible: policy, pricingLookup });
  assertEquals(await local.estimateCallCost(1_000_000, 1_000_000), undefined);
  assertEquals(lookups, 0);
  const remote = new OpenAIProvider({
    apiKey: "fixture-key",
    model: "synthetic-priced-model",
    compatible: { ...policy, profile: "openai" },
    pricingLookup,
  });
  assertEquals(await remote.estimateCallCost(1_000_000, 1_000_000), 10);
  assertEquals(lookups, 1);
  const unavailable = new OpenAIProvider({
    apiKey: "fixture-key",
    compatible: { ...policy, profile: "openai" },
    pricingLookup: { getModelPricing: () => Promise.reject(new Error("sensitive lookup failure")) },
  });
  assertEquals(await unavailable.estimateCallCost(10, 10), undefined);
});

const factory = new OpenAICompatibleProviderFactory();

Deno.test("compatible network permission preflight runs before any credential permission or read", async () => {
  const checks: string[] = [];
  const denied = new OpenAICompatibleProviderFactory((kind) => {
    checks.push(kind);
    return Promise.resolve("denied");
  });
  const error = await assertRejects(
    () => denied.create(options("local-test", "http://127.0.0.1:4312/v1/chat/completions")),
    ProviderFactoryError,
  );
  assertEquals(error.reasonCode, "net_permission_denied");
  assertEquals(checks, ["net"]);
});

function options(profile: "openai" | "deepseek" | "local-test", endpoint: string): IResolvedProviderOptions {
  return {
    provider: ProviderType.OPENAI_CHAT,
    model: "compat-fixture-v1",
    timeoutMs: 1000,
    compatible: {
      profile,
      endpoint,
      model: "compat-fixture-v1",
      allow_insecure_loopback: true,
      max_response_bytes: 1024,
      max_tool_argument_bytes: 512,
      max_history_bytes: 1024,
    },
  };
}

Deno.test("[security] local compatible tuple rejects alternate model, path and explicit key bypass", async () => {
  await withEnv({ EXA_COMPAT_TEST_API_KEY: "fixture-key" }, async () => {
    const valid = options("local-test", "http://127.0.0.1:4312/v1/chat/completions");
    for (
      const invalid of [
        { ...valid, model: "unqualified-model" },
        { ...valid, compatible: { ...valid.compatible!, endpoint: "http://127.0.0.1:4312/other-service" } },
        { ...valid, apiKey: "arbitrary-key-bypass" },
      ]
    ) {
      const error = await assertRejects(() => factory.create(invalid), ProviderFactoryError);
      assertEquals(error.reasonCode, "profile_mismatch");
      assertEquals(error.message.includes("arbitrary-key-bypass"), false);
    }
  });
});

Deno.test("compatible factory rejects remote profiles until their credential policy is implemented", async () => {
  await withEnv({ EXA_COMPAT_TEST_API_KEY: null }, async () => {
    const error = await assertRejects(() =>
      factory.create(options("deepseek", "http://127.0.0.1:4312/v1/chat/completions"))
    );
    assertEquals(error instanceof ProviderFactoryError, true);
    assertEquals((error as ProviderFactoryError).reasonCode, "profile_mismatch");
  });
});

Deno.test("compatible factory requires an environment key for local-test", async () => {
  await withEnv({ EXA_COMPAT_TEST_API_KEY: null }, async () => {
    const error = await assertRejects(() =>
      factory.create(options("local-test", "http://127.0.0.1:4312/v1/chat/completions"))
    );
    assertEquals((error as ProviderFactoryError).reasonCode, "credential_missing");
  });
});

Deno.test("[security] compatible local-test ignores a populated credential store", async () => {
  await withEnv({ EXA_COMPAT_TEST_API_KEY: null }, async () => {
    await SecureCredentialStore.set("EXA_COMPAT_TEST_API_KEY", "stored-fixture-key");
    try {
      const error = await assertRejects(
        () => factory.create(options("local-test", "http://127.0.0.1:4312/v1/chat/completions")),
        ProviderFactoryError,
      );
      assertEquals(error.reasonCode, "credential_missing");
      assertEquals(await SecureCredentialStore.get("EXA_COMPAT_TEST_API_KEY"), "stored-fixture-key");
    } finally {
      SecureCredentialStore.clear("EXA_COMPAT_TEST_API_KEY");
    }
  });
});

Deno.test("[security] compatible credential read maps NotCapable to a redacted factory reason", async () => {
  const originalGet = Deno.env.get.bind(Deno.env);
  using deniedRead = stub(Deno.env, "get", (name: string) => {
    if (name === "EXA_COMPAT_TEST_API_KEY") throw new Deno.errors.NotCapable("sensitive permission details");
    return originalGet(name);
  });
  const allowedPreflight = new OpenAICompatibleProviderFactory(() => Promise.resolve("granted"));
  const error = await assertRejects(
    () => allowedPreflight.create(options("local-test", "http://127.0.0.1:4312/v1/chat/completions")),
    ProviderFactoryError,
  );
  assertEquals(error.reasonCode, "env_permission_denied");
  assertEquals(error.message.includes("sensitive"), false);
  assertEquals(deniedRead.calls.length, 1);
});

Deno.test("compatible transport ignores ordinary OpenAI endpoint and retry settings", async () => {
  await withEnv({ EXA_COMPAT_TEST_API_KEY: "fixture-key" }, async () => {
    const endpoint = "http://127.0.0.1:4312/v1/chat/completions";
    const configured = options("local-test", endpoint);
    configured.config = ConfigSchema.parse({
      system: {},
      ai_endpoints: { openai: "https://ordinary.fixture.example/v1/chat/completions" },
      ai_retry: {
        providers: {
          openai: { max_attempts: 1, backoff_base_ms: 1000 },
          "openai-chat": { max_attempts: 2, backoff_base_ms: 100 },
        },
      },
    });
    const urls: string[] = [];
    using fetchStub = stub(globalThis, "fetch", (input: string | URL | Request) => {
      urls.push(String(input));
      return Promise.resolve(new Response("sensitive remote body", { status: 500 }));
    });
    const provider = await factory.create(configured);
    await assertRejects(() => provider.generate("prompt"));
    assertEquals(fetchStub.calls.length, 2);
    assertEquals(urls, [endpoint, endpoint]);
  });
});

Deno.test("compatible factory rejects endpoints outside explicit loopback before provider creation", async () => {
  await withEnv({ EXA_COMPAT_TEST_API_KEY: "fixture-key" }, async () => {
    const error = await assertRejects(() =>
      factory.create(options("local-test", "https://example.com/v1/chat/completions"))
    );
    assertEquals((error as ProviderFactoryError).reasonCode, "profile_mismatch");
  });
});

Deno.test("compatible factory rejects forged provider identity", async () => {
  await withEnv({ EXA_COMPAT_TEST_API_KEY: "fixture-key" }, async () => {
    const configured = { ...options("local-test", "http://127.0.0.1:4312/v1/chat/completions"), id: "mock-forged" };
    const error = await assertRejects(() => factory.create(configured));
    assertEquals((error as ProviderFactoryError).reasonCode, "profile_mismatch");
  });
});

Deno.test("compatible factory eagerly creates an identified local OpenAI provider", async () => {
  await withEnv({ EXA_COMPAT_TEST_API_KEY: "fixture-key" }, async () => {
    const provider = await factory.create(options("local-test", "http://127.0.0.1:4312/v1/chat/completions"));
    assertEquals(provider.id, "openai-chat-compat-fixture-v1");
    assertInstanceOf(provider, OpenAIProvider);
    assertEquals(provider.timeoutMs, 1000);
  });
});

Deno.test("compatible local-test endpoint requires explicit IPv4 loopback", async () => {
  await withEnv({ EXA_COMPAT_TEST_API_KEY: "fixture-key" }, async () => {
    for (
      const endpoint of [
        "http://localhost:4312/v1/chat/completions",
        "http://[::1]:4312/v1/chat/completions",
      ]
    ) {
      const error = await assertRejects(() => factory.create(options("local-test", endpoint)));
      assertEquals((error as ProviderFactoryError).reasonCode, "profile_mismatch");
    }
  });
});

Deno.test("compatible factory reports denied environment permission as a typed error", async () => {
  await withEnv({ EXA_COMPAT_TEST_API_KEY: "fixture-key" }, async () => {
    const deniedFactory = new OpenAICompatibleProviderFactory((kind) =>
      Promise.resolve(kind === "env" ? "denied" : "granted")
    );
    const error = await assertRejects(() =>
      deniedFactory.create(options("local-test", "http://127.0.0.1:4312/v1/chat/completions"))
    );
    assertEquals((error as ProviderFactoryError).reasonCode, "env_permission_denied");
  });
});

Deno.test("compatible factory reports denied network permission without issuing a request", async () => {
  await withEnv({ EXA_COMPAT_TEST_API_KEY: "fixture-key" }, async () => {
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      fetchCount++;
      return Promise.reject(new Error("fetch must not run"));
    };
    try {
      const deniedFactory = new OpenAICompatibleProviderFactory((kind) =>
        Promise.resolve(kind === "env" ? "granted" : "denied")
      );
      const error = await assertRejects(() =>
        deniedFactory.create(options("local-test", "http://127.0.0.1:4312/v1/chat/completions"))
      );
      assertEquals((error as ProviderFactoryError).reasonCode, "net_permission_denied");
      assertEquals(fetchCount, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("compatible provider applies one deadline across the generate call", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (_input, init) => {
    fetchCount++;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  try {
    const provider = new OpenAIProvider({
      apiKey: "fixture-key",
      model: "compat-fixture-v1",
      baseUrl: "http://127.0.0.1:4312/v1/chat/completions",
      timeoutMs: 10,
      compatible: options("local-test", "http://127.0.0.1:4312/v1/chat/completions").compatible,
    });
    const error = await assertRejects(() => provider.generate("prompt"), Error);
    assertEquals(error.name, "TimeoutError");
    assertEquals(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("compatible deadline interrupts retry backoff and caller cancellation before another attempt", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    calls++;
    return Promise.resolve(new Response("{}", { status: 429 }));
  };
  try {
    const provider = new OpenAIProvider({
      apiKey: "fixture-key",
      model: "compat-fixture-v1",
      timeoutMs: 20,
      maxRetries: 3,
      retryDelayMs: 500,
      compatible: options("local-test", "http://127.0.0.1:4312/v1/chat/completions").compatible,
    });
    const started = performance.now();
    await assertRejects(() => provider.generate("prompt"), Error);
    assertEquals(calls, 1);
    assertEquals(performance.now() - started < 400, true);
    const controller = new AbortController();
    controller.abort();
    await assertRejects(() => provider.generate("prompt", { requestSignal: controller.signal }), Error);
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
