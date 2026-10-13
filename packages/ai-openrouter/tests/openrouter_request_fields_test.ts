/**
 * @module OpenRouterRequestFieldsTest
 * @path packages/ai-openrouter/tests/openrouter_request_fields_test.ts
 * @related-files ["packages/ai-openrouter/README.md", "packages/ai-openrouter/src/openrouter_provider.ts"]
 * @architectural-layer AI
 * @description Every field the provider puts on the wire has a row in the package README, with its source.
 * The widest requests switch on every optional feature, so a new field fails this test until it is documented.
 */

import { assert, assertEquals } from "@std/assert";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { JSONObject, JSONValue } from "@exaix/core";
import { OpenRouterProvider } from "../src/openrouter_provider.ts";
import type { IOpenRouterRouting } from "../src/openrouter_provider.ts";
import type { IOpenRouterModelEntry } from "../src/openrouter_model_capabilities.ts";

const CACHED_MODEL = "qwen/qwen3-max";
const CACHE_PATH = "messages[].content[].cache_control";
const README_TEXT = await Deno.readTextFile(new URL("../README.md", import.meta.url));

const WIDE_ENTRY: IOpenRouterModelEntry = {
  id: CACHED_MODEL,
  supportedParameters: ["tools", "temperature", "top_p", "stop", "parallel_tool_calls", "reasoning", "response_format"],
  reasoning: { mandatory: false, supportedEfforts: ["high", "low"], supportsMaxTokens: false },
};

const WIDE_OPTIONS: IModelOptions = {
  tools: [{ name: "read_file", inputSchema: { type: "object" } }],
  toolChoice: { type: "auto", disable_parallel_tool_use: true },
  jsonSchema: {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false,
  },
  effort: "high",
  temperature: 0.2,
  top_p: 0.9,
  stop: ["END"],
  max_tokens: 256,
  traceId: crypto.randomUUID(),
};

const WIDE_ROUTING: IOpenRouterRouting = {
  models: ["vendor/a", "vendor/b"],
  provider: {
    only: ["p1"],
    ignore: ["p2"],
    sort: "latency",
    require_parameters: true,
    allow_fallbacks: true,
    quantizations: ["fp8"],
    max_price: { prompt: 1 },
  },
  zdr: true,
  data_collection: "deny",
};

const ORDER_ROUTING: IOpenRouterRouting = { provider: { order: ["p1"] } };

function isObject(value?: JSONValue): value is JSONObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sentBody(options: IModelOptions, routing: IOpenRouterRouting): Promise<JSONObject> {
  const origFetch = globalThis.fetch;
  let sent: JSONObject = {};
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"ok"}' }, finish_reason: "stop" }] })),
    );
  }) as typeof fetch;
  try {
    await new OpenRouterProvider({
      apiKey: "sk-test",
      model: CACHED_MODEL,
      routing,
      capabilities: { getEntry: () => Promise.resolve(WIDE_ENTRY) },
    }).generate("hi", options);
    return sent;
  } finally {
    globalThis.fetch = origFetch;
  }
}

/** Every top-level field, every provider field and the cache breakpoint path of one request body. */
function fieldPaths(body: JSONObject): string[] {
  const paths = new Set<string>();
  for (const [key, value] of Object.entries(body)) {
    paths.add(key);
    if (key === "provider" && isObject(value)) {
      for (const providerKey of Object.keys(value)) paths.add(`provider.${providerKey}`);
    }
    if (key === "messages" && Array.isArray(value)) {
      for (const message of value) {
        const content = isObject(message) ? message.content : undefined;
        if (Array.isArray(content) && content.some((part) => isObject(part) && "cache_control" in part)) {
          paths.add(CACHE_PATH);
        }
      }
    }
  }
  return [...paths];
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** The paths that have no table row that starts with the path in backticks. Cell padding is ignored. */
function undocumented(paths: readonly string[], readme: string): string[] {
  const hasRow = (path: string) =>
    new RegExp(`^\\|\\s*\`${path.replace(REGEX_SPECIALS, "\\$&")}\`\\s*\\|`, "m").test(readme);
  return paths.filter((path) => !hasRow(path)).sort();
}

Deno.test("every field of the widest requests is in the README table", async () => {
  const wide = fieldPaths(await sentBody(WIDE_OPTIONS, WIDE_ROUTING));
  const ordered = fieldPaths(await sentBody({ ...WIDE_OPTIONS, traceId: undefined }, ORDER_ROUTING));
  const paths = [...new Set([...wide, ...ordered])];
  assert(paths.includes("session_id"), "the widest request must carry the sticky session key");
  assert(paths.includes("provider.order"), "the ordered request must carry provider.order");
  assert(paths.includes(CACHE_PATH), "the widest request must carry a cache breakpoint");
  assert(paths.includes("reasoning") && paths.includes("response_format") && paths.includes("tool_choice"));
  assertEquals(undocumented(paths, README_TEXT), []);
});

Deno.test("a field missing from the table fails the check", () => {
  const readme = "| `model` | chat completions reference |";
  assertEquals(undocumented(["model", "brand_new_field"], readme), ["brand_new_field"]);
});
