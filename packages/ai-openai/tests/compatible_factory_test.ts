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
import type { IModelProvider, IResolvedProviderOptions } from "@exaix/ai/types.ts";
import { OPENAI_COMPATIBLE_PROFILE_DEFAULTS, ProviderType, SecureCredentialStore } from "@exaix/core";
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

Deno.test("compatible factory rejects a remote profile's endpoint on a local loopback host", async () => {
  await withEnv({ OPENAI_API_KEY: "fixture-key", DEEPSEEK_API_KEY: "fixture-key" }, async () => {
    for (const profile of ["openai", "deepseek"] as const) {
      const error = await assertRejects(
        () => factory.create(options(profile, "http://127.0.0.1:4312/v1/chat/completions")),
        ProviderFactoryError,
      );
      assertEquals(error.reasonCode, "profile_mismatch");
    }
  });
});

Deno.test("compatible factory normalizes a remote profile's documented root or /v1 base to the full endpoint", async () => {
  await withEnv({ OPENAI_API_KEY: "fixture-key", DEEPSEEK_API_KEY: null }, async () => {
    for (
      const endpoint of [
        "https://api.openai.com",
        "https://api.openai.com/v1",
        "https://api.openai.com/v1/chat/completions",
      ]
    ) {
      const provider = await factory.create({
        ...options("openai", endpoint),
        model: "gpt-6-luna",
        compatible: { ...options("openai", endpoint).compatible!, model: undefined },
      });
      assertInstanceOf(provider, OpenAIProvider);
    }
  });
});

Deno.test("compatible factory rejects a remote profile's endpoint on the wrong host, scheme or with userinfo/query", async () => {
  await withEnv({ OPENAI_API_KEY: "fixture-key" }, async () => {
    for (
      const endpoint of [
        "http://api.openai.com/v1/chat/completions",
        "https://api.deepseek.com/v1/chat/completions",
        "https://evil.example.com/v1/chat/completions",
        "https://user:pass@api.openai.com/v1/chat/completions",
        "https://api.openai.com/v1/chat/completions?debug=1",
        "https://api.openai.com/v2/chat/completions",
      ]
    ) {
      const error = await assertRejects(
        () => factory.create({ ...options("openai", endpoint), model: "gpt-6-luna" }),
        ProviderFactoryError,
      );
      assertEquals(error.reasonCode, "profile_mismatch", endpoint);
    }
  });
});

Deno.test("compatible factory pins each remote profile's qualified model and rejects an unqualified override", async () => {
  await withEnv({ OPENAI_API_KEY: "fixture-key", DEEPSEEK_API_KEY: "fixture-key" }, async () => {
    const cases = [
      { profile: "openai", model: "gpt-6-luna", endpoint: "https://api.openai.com/v1/chat/completions" },
      { profile: "deepseek", model: "deepseek-v4-pro", endpoint: "https://api.deepseek.com/v1/chat/completions" },
    ] as const;
    for (const { profile, model, endpoint } of cases) {
      const valid = {
        ...options(profile, endpoint),
        model,
        compatible: { ...options(profile, endpoint).compatible!, model: undefined },
      };
      const provider = await factory.create(valid);
      assertEquals(provider.id, `openai-chat-${model}`);
      const wrongTopLevel = await assertRejects(
        () => factory.create({ ...valid, model: "unqualified-model" }),
        ProviderFactoryError,
      );
      assertEquals(wrongTopLevel.reasonCode, "profile_mismatch");
      const wrongOverride = await assertRejects(
        () => factory.create({ ...valid, compatible: { ...valid.compatible!, model: "unqualified-model" } }),
        ProviderFactoryError,
      );
      assertEquals(wrongOverride.reasonCode, "profile_mismatch");
    }
  });
});

Deno.test("compatible factory reads each remote profile's fixed credential environment variable", async () => {
  await withEnv({ OPENAI_API_KEY: "openai-fixture-key", DEEPSEEK_API_KEY: null }, async () => {
    const openai = await factory.create({
      ...options("openai", "https://api.openai.com/v1/chat/completions"),
      model: "gpt-6-luna",
      compatible: {
        ...options("openai", "https://api.openai.com/v1/chat/completions").compatible!,
        model: undefined,
      },
    });
    assertInstanceOf(openai, OpenAIProvider);
    const error = await assertRejects(
      () =>
        factory.create({
          ...options("deepseek", "https://api.deepseek.com/v1/chat/completions"),
          model: "deepseek-v4-pro",
          compatible: {
            ...options("deepseek", "https://api.deepseek.com/v1/chat/completions").compatible!,
            model: undefined,
          },
        }),
      ProviderFactoryError,
    );
    assertEquals(error.reasonCode, "credential_missing");
  });
});

Deno.test("[security] a remote profile may read a stored credential but never writes one", async () => {
  await withEnv({ OPENAI_API_KEY: null }, async () => {
    await SecureCredentialStore.set("OPENAI_API_KEY", "stored-openai-key");
    try {
      const provider = await factory.create({
        ...options("openai", "https://api.openai.com/v1/chat/completions"),
        model: "gpt-6-luna",
        compatible: {
          ...options("openai", "https://api.openai.com/v1/chat/completions").compatible!,
          model: undefined,
        },
      });
      assertInstanceOf(provider, OpenAIProvider);
      assertEquals(await SecureCredentialStore.get("OPENAI_API_KEY"), "stored-openai-key");
    } finally {
      SecureCredentialStore.clear("OPENAI_API_KEY");
    }
  });
});

Deno.test("[security] a remote profile never persists an env-sourced credential, even with EXA_PERSIST_ENV_CREDENTIALS set", async () => {
  await withEnv({ DEEPSEEK_API_KEY: "env-deepseek-key" }, async () => {
    const persistFlag = globalThis as { EXA_PERSIST_ENV_CREDENTIALS?: boolean };
    persistFlag.EXA_PERSIST_ENV_CREDENTIALS = true;
    try {
      assertEquals(await SecureCredentialStore.get("DEEPSEEK_API_KEY"), null);
      const provider = await factory.create({
        ...options("deepseek", "https://api.deepseek.com/v1/chat/completions"),
        model: "deepseek-v4-pro",
        compatible: {
          ...options("deepseek", "https://api.deepseek.com/v1/chat/completions").compatible!,
          model: undefined,
        },
      });
      assertInstanceOf(provider, OpenAIProvider);
      assertEquals(await SecureCredentialStore.get("DEEPSEEK_API_KEY"), null);
    } finally {
      delete persistFlag.EXA_PERSIST_ENV_CREDENTIALS;
      SecureCredentialStore.clear("DEEPSEEK_API_KEY");
    }
  });
});

Deno.test("compatible factory requires the qualified network permission for each remote profile's host", async () => {
  await withEnv({ OPENAI_API_KEY: "fixture-key", DEEPSEEK_API_KEY: "fixture-key" }, async () => {
    const cases = [
      { profile: "openai", endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-6-luna" },
      { profile: "deepseek", endpoint: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-v4-pro" },
    ] as const;
    for (const { profile, endpoint, model } of cases) {
      const denied = new OpenAICompatibleProviderFactory((kind) =>
        Promise.resolve(kind === "env" ? "granted" : "denied")
      );
      const error = await assertRejects(
        () =>
          denied.create({
            ...options(profile, endpoint),
            model,
            compatible: { ...options(profile, endpoint).compatible!, model: undefined },
          }),
        ProviderFactoryError,
      );
      assertEquals(error.reasonCode, "net_permission_denied");
    }
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

const SELF_HOSTED_MODEL = "llama3.1:8b";
const SELF_HOSTED_KEY_ENV = "EXA_COMPAT_SELF_HOSTED_API_KEY";

function selfHostedOptions(
  endpoint: string,
  allowInsecureLoopback = false,
  model = SELF_HOSTED_MODEL,
): IResolvedProviderOptions {
  return {
    provider: ProviderType.OPENAI_CHAT,
    model,
    timeoutMs: 1000,
    compatible: {
      profile: "self-hosted",
      endpoint,
      model,
      allow_insecure_loopback: allowInsecureLoopback,
      max_response_bytes: 1024,
      max_tool_argument_bytes: 512,
      max_history_bytes: 1024,
    },
  };
}

/** Runs one real generate call against a stubbed transport and returns the request headers. */
async function captureRequestHeaders(provider: IModelProvider): Promise<Headers> {
  let captured: Headers | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input: string | URL | Request, init?: RequestInit) => {
    captured = new Headers(init?.headers);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          model: SELF_HOSTED_MODEL,
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  };
  try {
    await provider.generate("prompt");
  } finally {
    globalThis.fetch = originalFetch;
  }
  return captured!;
}

Deno.test("[phase203.factory] self-hosted reads its endpoint and model from the config", async () => {
  const provider = await factory.create(selfHostedOptions("https://gpu.internal:8443/v1/chat/completions"));
  assertInstanceOf(provider, OpenAIProvider);
  assertEquals(provider.id, `openai-chat-${SELF_HOSTED_MODEL}`);
  assertEquals(provider.timeoutMs, 1000);
});

Deno.test("[phase203.factory][security] self-hosted rejects every endpoint outside its declared rule", async () => {
  const rejections: Array<[string, boolean]> = [
    ["http://gpu.internal:11434/v1/chat/completions", false],
    ["http://gpu.internal:11434/v1/chat/completions", true],
    ["http://127.0.0.1:11434/v1/chat/completions", false],
    ["https://user:pass@gpu.internal/v1/chat/completions", false],
    ["https://gpu.internal/v1/chat/completions?debug=1", false],
    ["https://gpu.internal/v1/chat/completions#fragment", false],
    ["https://gpu.internal/v1/models", false],
    ["https://gpu.internal/chat/completions/", false],
    ["not-a-url", false],
  ];
  for (const [endpoint, allowInsecureLoopback] of rejections) {
    const error = await assertRejects(
      () => factory.create(selfHostedOptions(endpoint, allowInsecureLoopback)),
      ProviderFactoryError,
    );
    assertEquals(error.reasonCode, "profile_mismatch", endpoint);
    assertEquals(error.message.includes("user:pass"), false);
  }
});

Deno.test("[phase203.factory] self-hosted accepts HTTPS anywhere and plain HTTP on loopback with the opt-in", async () => {
  const acceptances: Array<[string, boolean]> = [
    ["https://gpu.internal/v1/chat/completions", false],
    ["https://gpu.internal/chat/completions", false],
    ["https://127.0.0.1:11434/v1/chat/completions", false],
    ["http://127.0.0.1:11434/v1/chat/completions", true],
    ["http://127.0.0.1:11434/chat/completions", true],
  ];
  for (const [endpoint, allowInsecureLoopback] of acceptances) {
    assertInstanceOf(
      await factory.create(selfHostedOptions(endpoint, allowInsecureLoopback)),
      OpenAIProvider,
      `${endpoint} (opt-in: ${allowInsecureLoopback})`,
    );
  }
});

Deno.test("[phase203.factory] self-hosted rejects a model that differs from its compatible model", async () => {
  const valid = selfHostedOptions("https://gpu.internal/v1/chat/completions");
  for (
    const invalid of [
      { ...valid, model: "other-model" },
      { ...valid, compatible: { ...valid.compatible!, model: undefined } },
    ]
  ) {
    const error = await assertRejects(() => factory.create(invalid), ProviderFactoryError);
    assertEquals(error.reasonCode, "profile_mismatch");
  }
});

Deno.test("[phase203.factory] self-hosted sends no Authorization without a key and sends one when the env key is set", async () => {
  await withEnv({ [SELF_HOSTED_KEY_ENV]: null }, async () => {
    const withoutKey = await factory.create(selfHostedOptions("https://gpu.internal/v1/chat/completions"));
    assertEquals((await captureRequestHeaders(withoutKey)).get("Authorization"), null);
    assertEquals((await captureRequestHeaders(withoutKey)).get("Content-Type"), "application/json");
  });
  await withEnv({ [SELF_HOSTED_KEY_ENV]: "self-hosted-key" }, async () => {
    const withKey = await factory.create(selfHostedOptions("https://gpu.internal/v1/chat/completions"));
    assertEquals((await captureRequestHeaders(withKey)).get("Authorization"), "Bearer self-hosted-key");
  });
});

Deno.test("[phase203.factory][security] the self-hosted key read checks the env permission, ignores the store and persists nothing", async () => {
  const checks: string[] = [];
  const deniedEnv = new OpenAICompatibleProviderFactory((kind) => {
    checks.push(kind);
    return Promise.resolve(kind === "env" ? "denied" : "granted");
  });
  const error = await assertRejects(
    () => deniedEnv.create(selfHostedOptions("https://gpu.internal/v1/chat/completions")),
    ProviderFactoryError,
  );
  assertEquals(error.reasonCode, "env_permission_denied");
  assertEquals(checks, ["net", "env"]);

  await withEnv({ [SELF_HOSTED_KEY_ENV]: null }, async () => {
    await SecureCredentialStore.set(SELF_HOSTED_KEY_ENV, "stored-self-hosted-key");
    try {
      const provider = await factory.create(selfHostedOptions("https://gpu.internal/v1/chat/completions"));
      assertEquals((await captureRequestHeaders(provider)).get("Authorization"), null);
      assertEquals(await SecureCredentialStore.get(SELF_HOSTED_KEY_ENV), "stored-self-hosted-key");
    } finally {
      SecureCredentialStore.clear(SELF_HOSTED_KEY_ENV);
    }
  });
});

Deno.test("[regression] openai and deepseek keep their pinned model, host and required credential", async () => {
  await withEnv({ OPENAI_API_KEY: null, DEEPSEEK_API_KEY: null }, async () => {
    for (const profile of ["openai", "deepseek"] as const) {
      const defaults = OPENAI_COMPATIBLE_PROFILE_DEFAULTS[profile];
      const base = options(profile, defaults.endpoint);
      const credentialError = await assertRejects(
        () =>
          factory.create({
            ...base,
            model: defaults.model,
            compatible: { ...base.compatible!, model: undefined },
          }),
        ProviderFactoryError,
      );
      assertEquals(credentialError.reasonCode, "credential_missing", profile);

      const hostError = await assertRejects(
        () =>
          factory.create({
            ...base,
            model: defaults.model,
            compatible: { ...base.compatible!, endpoint: "https://evil.example.com/v1/chat/completions" },
          }),
        ProviderFactoryError,
      );
      assertEquals(hostError.reasonCode, "profile_mismatch", profile);
    }
  });
});

/** Self-hosted options whose compatible block declares the service's own key variable. */
function keyedSelfHostedOptions(keyEnv: string): IResolvedProviderOptions {
  const options = selfHostedOptions("https://gpu.internal/v1/chat/completions");
  return { ...options, compatible: { ...options.compatible!, key_env: keyEnv } };
}

Deno.test("[security] a self-hosted service never sends another service's key", async () => {
  await withEnv({ SVC_A_KEY: "key-a", SVC_B_KEY: "key-b", [SELF_HOSTED_KEY_ENV]: "shared-key" }, async () => {
    const serviceA = await factory.create(keyedSelfHostedOptions("SVC_A_KEY"));
    const serviceB = await factory.create(keyedSelfHostedOptions("SVC_B_KEY"));
    assertEquals((await captureRequestHeaders(serviceA)).get("Authorization"), "Bearer key-a");
    assertEquals((await captureRequestHeaders(serviceB)).get("Authorization"), "Bearer key-b");
  });
});

Deno.test("[security] a catalog key_env is read for a self-hosted service", async () => {
  await withEnv({ SVC_A_KEY: null, [SELF_HOSTED_KEY_ENV]: "shared-key" }, async () => {
    // A declared variable is required: the shared fallback never stands in for it.
    const error = await assertRejects(() => factory.create(keyedSelfHostedOptions("SVC_A_KEY")), ProviderFactoryError);
    assertEquals(error.reasonCode, "credential_missing");
  });
  await withEnv({ SVC_A_KEY: "declared-key", [SELF_HOSTED_KEY_ENV]: null }, async () => {
    const provider = await factory.create(keyedSelfHostedOptions("SVC_A_KEY"));
    assertEquals((await captureRequestHeaders(provider)).get("Authorization"), "Bearer declared-key");
  });
});
