/**
 * @module OpenRouterModelCapabilitiesTest
 * @path packages/ai-openrouter/tests/openrouter_model_capabilities_test.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_model_capabilities.ts", "packages/ai-openrouter/tests/fixtures/openrouter_models_fixture.json"]
 * @architectural-layer AI
 * @description Verifies the per-model capability lookup: it parses a recorded models-endpoint fixture,
 * caches it for a TTL with an injected clock, fails soft with a typed journal event, and never puts the
 * API key anywhere except the Authorization header.
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { createMockLogger } from "@exaix/testing";
import { DomainEventType } from "@exaix/core/events";
import type { Opt, Reason } from "@exaix/core/types";
import {
  deriveOpenRouterModelsUrl,
  type IOpenRouterModelCapabilitiesOptions,
  OpenRouterModelCapabilities,
} from "../src/openrouter_model_capabilities.ts";

const FIXTURE = await Deno.readTextFile(new URL("./fixtures/openrouter_models_fixture.json", import.meta.url));
const MODELS_URL = "https://openrouter.ai/api/v1/models";
const API_KEY = "sk-or-secret-key-value";
const TTL_MS = 1000;
const BACKOFF_MS = 50;
const PROVIDER_ID = "openrouter-test";

interface IFetchProbe {
  calls: number;
  urls: string[];
  authorization: Array<string | null>;
}

function stubFetch(respond: () => Response | Promise<Response>): { probe: IFetchProbe; restore: () => void } {
  const origFetch = globalThis.fetch;
  const probe: IFetchProbe = { calls: 0, urls: [], authorization: [] };
  globalThis.fetch = (async (input: string | URL | Request, init?: Opt<RequestInit, Reason.OptionalContext>) => {
    probe.calls++;
    probe.urls.push(String(input));
    probe.authorization.push(new Headers(init?.headers).get("Authorization"));
    return await respond();
  }) as typeof fetch;
  return { probe, restore: () => (globalThis.fetch = origFetch) };
}

function makeLookup(
  overrides: Partial<IOpenRouterModelCapabilitiesOptions> = {},
): { lookup: OpenRouterModelCapabilities; logger: ReturnType<typeof createMockLogger>; clock: { now: number } } {
  const logger = createMockLogger();
  const clock = { now: 0 };
  const lookup = new OpenRouterModelCapabilities({
    apiKey: API_KEY,
    modelsUrl: MODELS_URL,
    providerId: PROVIDER_ID,
    timeoutMs: 5000,
    ttlMs: TTL_MS,
    failureBackoffMs: BACKOFF_MS,
    logger,
    now: () => clock.now,
    ...overrides,
  });
  return { lookup, logger, clock };
}

const ok = (): Response => new Response(FIXTURE, { status: 200 });

Deno.test("pricing.prompt and pricing.completion are parsed per million tokens", async () => {
  const { restore } = stubFetch(() =>
    Response.json({
      data: [{ id: "priced/model", pricing: { prompt: "0.000003", completion: "0.000015" } }, {
        id: "free/model",
        pricing: { prompt: "0", completion: "0" },
      }],
    })
  );
  try {
    const { lookup } = makeLookup();
    assertEquals(await lookup.getEntry("priced/model"), {
      id: "priced/model",
      supportedParameters: [],
      pricing: { inputPerMtok: 3, outputPerMtok: 15 },
    });
    assertEquals(await lookup.getEntry("free/model"), {
      id: "free/model",
      supportedParameters: [],
      pricing: { inputPerMtok: 0, outputPerMtok: 0 },
    });
  } finally {
    restore();
  }
});

Deno.test("[security] a non-numeric or negative price is ignored without dropping the model or its valid price", async () => {
  for (const invalid of ["garbage", "-0.1", "NaN", "Infinity", "1e309", "1e303", "", " ", 0, false, {}, null]) {
    const { restore } = stubFetch(() =>
      Response.json({
        data: [
          { id: "invalid/input", context_length: 8000, pricing: { prompt: invalid, completion: "0.000001" } },
          { id: "invalid/output", pricing: { prompt: "0.000002", completion: invalid } },
        ],
      })
    );
    try {
      const { lookup } = makeLookup();
      assertEquals(await lookup.getEntry("invalid/input"), {
        id: "invalid/input",
        contextLength: 8000,
        supportedParameters: [],
        pricing: { outputPerMtok: 1 },
      });
      assertEquals(await lookup.getEntry("invalid/output"), {
        id: "invalid/output",
        supportedParameters: [],
        pricing: { inputPerMtok: 2 },
      });
    } finally {
      restore();
    }
  }
});

Deno.test("a recorded models-endpoint fixture parses, with the capability fields", async () => {
  const { restore } = stubFetch(ok);
  try {
    const { lookup } = makeLookup();
    const qwen = await lookup.getEntry("qwen/qwen3.7-flash");
    assertEquals(qwen?.contextLength, 1000000);
    assert(qwen?.supportedParameters.includes("tools"));
    assert(qwen?.supportedParameters.includes("response_format"));
    assertEquals(qwen?.tokenizer, "Qwen");
    assertEquals(qwen?.reasoning?.supportsMaxTokens, true);
    assertEquals(qwen?.reasoning?.supportedEfforts, []);

    const deepseek = await lookup.getEntry("~deepseek/deepseek-flash-latest");
    assertEquals(deepseek?.reasoning?.supportedEfforts, ["max", "high", "low"]);
    assertEquals(deepseek?.reasoning?.defaultEffort, "high");
    assertEquals(deepseek?.reasoning?.mandatory, false);
    assertEquals(deepseek?.tokenizer, "Router");
  } finally {
    restore();
  }
});

Deno.test("a model with no supported parameters is present, and an unknown model is absent", async () => {
  const { restore } = stubFetch(ok);
  try {
    const { lookup } = makeLookup();
    assertEquals((await lookup.getEntry("nvidia/switchyard"))?.supportedParameters, []);
    assertEquals(await lookup.getEntry("nobody/no-such-model"), undefined);
  } finally {
    restore();
  }
});

Deno.test("a second lookup within the TTL does not fetch", async () => {
  const { probe, restore } = stubFetch(ok);
  try {
    const { lookup, clock } = makeLookup();
    await lookup.getEntry("qwen/qwen3.7-flash");
    clock.now = TTL_MS - 1;
    await lookup.getEntry("upstage/solar-mini4");
    assertEquals(probe.calls, 1);
  } finally {
    restore();
  }
});

Deno.test("a lookup after the TTL fetches again", async () => {
  const { probe, restore } = stubFetch(ok);
  try {
    const { lookup, clock } = makeLookup();
    await lookup.getEntry("qwen/qwen3.7-flash");
    clock.now = TTL_MS;
    await lookup.getEntry("qwen/qwen3.7-flash");
    assertEquals(probe.calls, 2);
  } finally {
    restore();
  }
});

Deno.test("concurrent lookups share one fetch", async () => {
  const { probe, restore } = stubFetch(ok);
  try {
    const { lookup } = makeLookup();
    const entries = await Promise.all([
      lookup.getEntry("qwen/qwen3.7-flash"),
      lookup.getEntry("upstage/solar-mini4"),
      lookup.getEntry("inclusionai/ling-3.0-flash"),
    ]);
    assertEquals(entries.map((entry) => entry?.id), [
      "qwen/qwen3.7-flash",
      "upstage/solar-mini4",
      "inclusionai/ling-3.0-flash",
    ]);
    assertEquals(probe.calls, 1);
  } finally {
    restore();
  }
});

interface IFailurePayload {
  model: string;
  reason: string;
  status?: number;
}

function lastFailure(logger: ReturnType<typeof createMockLogger>): { action: string; payload: IFailurePayload } {
  const call = logger.warn.calls.at(-1);
  assert(call, "a warning was journaled");
  return { action: call.args[0], payload: JSON.parse(JSON.stringify(call.args[2])) as IFailurePayload };
}

Deno.test("a body over the size cap fails soft with size_limit", async () => {
  const { restore } = stubFetch(ok);
  try {
    const { lookup, logger } = makeLookup({ maxResponseBytes: 100 });
    assertEquals(await lookup.getEntry("qwen/qwen3.7-flash"), undefined);
    const failure = lastFailure(logger);
    assertEquals(failure.action, DomainEventType.OpenRouterCapabilityLookupFailed);
    assertEquals(failure.payload, { model: "qwen/qwen3.7-flash", reason: "size_limit" });
  } finally {
    restore();
  }
});

Deno.test("a malformed body fails soft with parse_error", async () => {
  for (const body of ["not json at all", JSON.stringify({ data: "nope" }), JSON.stringify({ models: [] })]) {
    const { restore } = stubFetch(() => new Response(body, { status: 200 }));
    try {
      const { lookup, logger } = makeLookup();
      assertEquals(await lookup.getEntry("qwen/qwen3.7-flash"), undefined);
      assertEquals(lastFailure(logger).payload, { model: "qwen/qwen3.7-flash", reason: "parse_error" });
    } finally {
      restore();
    }
  }
});

Deno.test("one malformed entry does not drop the others", async () => {
  const body = JSON.stringify({
    data: [{ id: 42 }, { id: "good/model", supported_parameters: ["tools"], context_length: 8000 }],
  });
  const { restore } = stubFetch(() => new Response(body, { status: 200 }));
  try {
    const { lookup, logger } = makeLookup();
    assertEquals((await lookup.getEntry("good/model"))?.supportedParameters, ["tools"]);
    assertEquals(logger.warn.calls.length, 0);
  } finally {
    restore();
  }
});

Deno.test("an HTTP error fails soft with http_error and the status", async () => {
  const { restore } = stubFetch(() => new Response("upstream down", { status: 500 }));
  try {
    const { lookup, logger } = makeLookup();
    assertEquals(await lookup.getEntry("qwen/qwen3.7-flash"), undefined);
    assertEquals(lastFailure(logger).payload, { model: "qwen/qwen3.7-flash", reason: "http_error", status: 500 });
  } finally {
    restore();
  }
});

Deno.test("a fetch timeout fails soft with timeout", async () => {
  const { restore } = stubFetch(() => Promise.reject(new DOMException("timed out", "TimeoutError")));
  try {
    const { lookup, logger } = makeLookup();
    assertEquals(await lookup.getEntry("qwen/qwen3.7-flash"), undefined);
    assertEquals(lastFailure(logger).payload, { model: "qwen/qwen3.7-flash", reason: "timeout" });
  } finally {
    restore();
  }
});

Deno.test("a failed lookup is not retried until the backoff passes, and a later success replaces it", async () => {
  let healthy = false;
  const { probe, restore } = stubFetch(() => healthy ? ok() : new Response("down", { status: 503 }));
  try {
    const { lookup, clock } = makeLookup();
    await lookup.getEntry("qwen/qwen3.7-flash");
    clock.now = BACKOFF_MS - 1;
    await lookup.getEntry("qwen/qwen3.7-flash");
    assertEquals(probe.calls, 1);
    healthy = true;
    clock.now = BACKOFF_MS;
    assertEquals((await lookup.getEntry("qwen/qwen3.7-flash"))?.id, "qwen/qwen3.7-flash");
    assertEquals(probe.calls, 2);
  } finally {
    restore();
  }
});

Deno.test("a refresh failure keeps the entries of the last good snapshot", async () => {
  let healthy = true;
  const { restore } = stubFetch(() => healthy ? ok() : new Response("down", { status: 503 }));
  try {
    const { lookup, clock } = makeLookup();
    await lookup.getEntry("qwen/qwen3.7-flash");
    healthy = false;
    clock.now = TTL_MS;
    assertEquals((await lookup.getEntry("qwen/qwen3.7-flash"))?.id, "qwen/qwen3.7-flash");
  } finally {
    restore();
  }
});

Deno.test("the key appears only in the Authorization header, never in the URL or an event payload", async () => {
  const { probe, restore } = stubFetch(() => new Response("down", { status: 500 }));
  try {
    const { lookup, logger } = makeLookup();
    await lookup.getEntry("qwen/qwen3.7-flash");
    assertEquals(probe.authorization, [`Bearer ${API_KEY}`]);
    assertFalse(probe.urls.join(" ").includes(API_KEY));
    assertFalse(JSON.stringify(logger.warn.calls.map((call) => call.args)).includes(API_KEY));
  } finally {
    restore();
  }
});

Deno.test("the models URL is derived from the configured chat completions endpoint", () => {
  assertEquals(
    deriveOpenRouterModelsUrl("https://openrouter.ai/api/v1/chat/completions"),
    "https://openrouter.ai/api/v1/models",
  );
  assertEquals(deriveOpenRouterModelsUrl("https://proxy.example/v1/"), "https://proxy.example/v1/models");
  assertEquals(deriveOpenRouterModelsUrl("https://proxy.example/v1"), "https://proxy.example/v1/models");
});

Deno.test("attachLogger supplies a logger to a lookup that has none", async () => {
  const { restore } = stubFetch(() => new Response("no", { status: 500 }));
  try {
    const { lookup, clock } = makeLookup({ logger: undefined });
    const logger = createMockLogger();
    assertEquals(await lookup.getEntry("qwen/qwen3.7-flash"), undefined);
    lookup.attachLogger(logger);
    clock.now += BACKOFF_MS + 1;
    assertEquals(await lookup.getEntry("qwen/qwen3.7-flash"), undefined);
    assertEquals(lastFailure(logger).action, DomainEventType.OpenRouterCapabilityLookupFailed);
    assertEquals(logger.warn.calls.length, 1);
  } finally {
    restore();
  }
});

Deno.test("attachLogger does not replace an existing logger", async () => {
  const { restore } = stubFetch(() => new Response("no", { status: 500 }));
  try {
    const { lookup, logger: original } = makeLookup();
    const replacement = createMockLogger();
    lookup.attachLogger(replacement);
    assertEquals(await lookup.getEntry("qwen/qwen3.7-flash"), undefined);
    assertEquals(original.warn.calls.length, 1);
    assertEquals(replacement.warn.calls.length, 0);
  } finally {
    restore();
  }
});
