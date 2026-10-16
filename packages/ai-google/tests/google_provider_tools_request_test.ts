/**
 * @module GoogleProviderToolsRequestTest
 * @path packages/ai-google/tests/google_provider_tools_request_test.ts
 * @description Phase 153 Step 3 — tests that `GoogleProvider.attemptGenerate()` serializes
 * `IModelOptions.tools`/`toolChoice`/`priorTurn` into Gemini's `tools[].functionDeclarations[]`
 * / `toolConfig.functionCallingConfig` request fields per the `IToolChoice` mapping table
 * (AUTO/ANY/ANY+allowedFunctionNames/NONE), and a `role:"model"`/`role:"user"`
 * `functionCall`/`functionResponse` priorTurn sequence.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/ai-google/src/google_provider.ts",
 *   "packages/ai/tests/providers/anthropic_provider_tools_request_full_test.ts"
 * ]
 */

import { assert, assertEquals, assertExists, assertFalse } from "@std/assert";
import { ProviderRegistry } from "@exaix/ai";
import { PricingTier } from "@exaix/core";
import { GOOGLE_PROVIDER_METADATA } from "../src/constants.ts";
import { GoogleProvider } from "../src/google_provider.ts";
import type { JSONValue } from "@exaix/core";

interface CapturedFunctionDeclaration {
  name: string;
  description?: string;
  parameters: Record<string, JSONValue>;
}

interface CapturedToolConfig {
  functionCallingConfig: { mode: string; allowedFunctionNames?: string[] };
}

interface CapturedPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, JSONValue> };
  thoughtSignature?: string;
  functionResponse?: { name: string; response: { content: JSONValue } };
}

interface CapturedContent {
  role?: string;
  parts: CapturedPart[];
}

interface CapturedBody {
  contents?: CapturedContent[];
  tools?: Array<{ functionDeclarations: CapturedFunctionDeclaration[] }>;
  toolConfig?: CapturedToolConfig;
}

async function capturedBodyOf(options?: Parameters<GoogleProvider["generate"]>[1]): Promise<CapturedBody> {
  const provider = new GoogleProvider({ apiKey: "test-key" });
  const origFetch = globalThis.fetch;
  let capturedBody: CapturedBody = {};
  try {
    globalThis.fetch = (_input: string | Request | URL, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "ok" }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };
    await provider.generate("test prompt", options);
    return capturedBody;
  } finally {
    globalThis.fetch = origFetch;
  }
}

Deno.test("GoogleProvider.attemptGenerate serializes IToolDefinition into tools[].functionDeclarations", async () => {
  const body = await capturedBodyOf({
    tools: [{
      name: "write_file",
      description: "Write content to a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
    }],
  });

  assertExists(body.tools);
  assertEquals(body.tools.length, 1);
  assertEquals(body.tools[0].functionDeclarations.length, 1);
  assertEquals(body.tools[0].functionDeclarations[0].name, "write_file");
  assertEquals(body.tools[0].functionDeclarations[0].description, "Write content to a file");
  assertEquals(body.tools[0].functionDeclarations[0].parameters, {
    type: "object",
    properties: { path: { type: "string" } },
  });
});

Deno.test("GoogleProvider.attemptGenerate maps IToolChoice {type:auto} to {mode:AUTO}", async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "auto" } });
  assertEquals(body.toolConfig?.functionCallingConfig.mode, "AUTO");
  assertEquals(body.toolConfig?.functionCallingConfig.allowedFunctionNames, undefined);
});

Deno.test("GoogleProvider.attemptGenerate maps IToolChoice {type:any} to {mode:ANY}", async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "any" } });
  assertEquals(body.toolConfig?.functionCallingConfig.mode, "ANY");
  assertEquals(body.toolConfig?.functionCallingConfig.allowedFunctionNames, undefined);
});

Deno.test("GoogleProvider.attemptGenerate maps IToolChoice {type:tool,name} to {mode:ANY,allowedFunctionNames:[name]}", async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "tool", name: "patch_file" } });
  assertEquals(body.toolConfig?.functionCallingConfig.mode, "ANY");
  assertEquals(body.toolConfig?.functionCallingConfig.allowedFunctionNames, ["patch_file"]);
});

Deno.test("GoogleProvider.attemptGenerate maps IToolChoice {type:none} to {mode:NONE}", async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "none" } });
  assertEquals(body.toolConfig?.functionCallingConfig.mode, "NONE");
});

Deno.test("GoogleProvider.attemptGenerate omits tools/toolConfig when absent (unchanged)", async () => {
  const body = await capturedBodyOf({});
  assertEquals(body.tools, undefined);
  assertEquals(body.toolConfig, undefined);
});

Deno.test("GoogleProvider.attemptGenerate with priorTurn produces Gemini-legal contents ordering (GAP-153-E)", async () => {
  const body = await capturedBodyOf({
    priorTurn: {
      toolUseId: "call_1",
      toolName: "patch_file",
      toolInput: { path: "a.ts", diff: "..." },
      toolResultContent: "patched successfully",
      toolResultIsError: false,
    },
  });

  assertExists(body.contents);
  // User text must lead so the replayed model functionCall has an immediately preceding
  // user turn, as required by Gemini's conversation ordering.
  assertEquals(body.contents.length, 3);
  assertEquals(body.contents[0].role, "user");
  assertEquals(body.contents[0].parts[0].text, "test prompt");

  assertEquals(body.contents[1].role, "model");
  assertExists(body.contents[1].parts[0].functionCall);
  assertEquals(body.contents[1].parts[0].functionCall!.name, "patch_file");
  assertEquals(body.contents[1].parts[0].functionCall!.args, { path: "a.ts", diff: "..." });

  assertEquals(body.contents[2].role, "user");
  assertExists(body.contents[2].parts[0].functionResponse);
  assertEquals(body.contents[2].parts[0].functionResponse!.name, "patch_file");
  assertEquals(body.contents[2].parts[0].functionResponse!.response.content, "patched successfully");
});

Deno.test("GoogleProvider.attemptGenerate replays priorTurn thoughtSignature in the model functionCall part (GAP-153-E)", async () => {
  const body = await capturedBodyOf({
    priorTurn: {
      toolUseId: "call_1",
      toolName: "patch_file",
      toolInput: { path: "a.ts", diff: "..." },
      toolResultContent: "patched successfully",
      toolResultIsError: false,
      thoughtSignature: "sig-abc123",
    },
  });

  assertExists(body.contents);
  // Gemini requires the model's replayed functionCall to carry the original
  // thoughtSignature as a sibling of functionCall on the part; without it Gemini returns
  // an HTTP 400 ("Function call is missing a thought_signature in functionCall parts").
  assertEquals(body.contents[1].role, "model");
  assertEquals(body.contents[1].parts[0].functionCall!.name, "patch_file");
  assertEquals(body.contents[1].parts[0].thoughtSignature, "sig-abc123");
});

Deno.test("GoogleProvider.attemptGenerate asks for a text answer beside the functionResponse when tool choice is none", async () => {
  const body = await capturedBodyOf({
    toolChoice: { type: "none" },
    priorTurn: {
      toolUseId: "call_1",
      toolName: "read_file",
      toolInput: { path: "a.ts" },
      toolResultContent: "contents",
      toolResultIsError: false,
    },
  });

  // Gemini 3 ignores functionCallingConfig mode NONE and calls another tool, leaving no text.
  const parts = body.contents![2].parts;
  assertExists(parts[0].functionResponse);
  assertEquals(typeof parts[1].text, "string");
});

Deno.test("[regression] GoogleProvider.attemptGenerate without priorTurn produces a single content entry", async () => {
  const body = await capturedBodyOf({});
  assertEquals(body.contents?.length, 1);
  assertEquals(body.contents?.[0].parts[0].text, "test prompt");
});

// Grouped replay: a completed response round replays verbatim.

const GOOGLE_ROUND_PARTS: Array<Record<string, JSONValue>> = [
  { text: "Reading two files." },
  { functionCall: { name: "read_file", args: { path: "a.txt" } }, thoughtSignature: "sig-a" },
  { functionCall: { name: "read_file", args: { path: "b.txt" } } },
];

function groupedRoundOptions(toolChoiceType?: "none"): Parameters<GoogleProvider["generate"]>[1] {
  return {
    tools: [{ name: "read_file", inputSchema: { type: "object", properties: {} } }],
    toolChoice: toolChoiceType === "none" ? { type: "none" } : { type: "auto" },
    priorRound: {
      assistant: { provider: "google", parts: GOOGLE_ROUND_PARTS },
      calls: [
        {
          toolUseId: "call-1",
          index: 1,
          toolName: "read_file",
          toolInput: { path: "a.txt" },
          thoughtSignature: "sig-a",
          toolResultContent: "A-CONTENT",
          toolResultIsError: false,
        },
        {
          toolUseId: "call-2",
          index: 2,
          toolName: "read_file",
          toolInput: { path: "b.txt" },
          toolResultContent: "B-CONTENT",
          toolResultIsError: false,
        },
      ],
    },
  };
}

Deno.test("GoogleProvider.attemptGenerate with priorRound replays every original model part in order, then one grouped functionResponse message", async () => {
  const body = await capturedBodyOf(groupedRoundOptions());
  const contents = body.contents ?? [];
  assertEquals(contents.length, 3);
  assertEquals(contents[1].role, "model");
  assertEquals(contents[1].parts as JSONValue[], GOOGLE_ROUND_PARTS);
  assertEquals(contents[2].role, "user");
  assertEquals(contents[2].parts.length, 2);
  assertEquals(contents[2].parts[0].functionResponse?.name, "read_file");
  assertEquals(contents[2].parts[0].functionResponse?.response.content, "A-CONTENT");
  assertEquals(contents[2].parts[1].functionResponse?.response.content, "B-CONTENT");
});

/** Registers Google as the boot does, so the native-conversation gate admits the test provider. */
function registerGoogleNativeMetadata(): void {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("google", null as never, {
    ...GOOGLE_PROVIDER_METADATA,
    capabilities: [...GOOGLE_PROVIDER_METADATA.capabilities],
    pricingTier: PricingTier.LOW,
    supportsNativeTools: true,
    supportsParallelToolReplay: true,
    supportsNativeConversation: true,
    supportsNativeRoundReplay: true,
  });
}

/** A native conversation whose completed rounds are the grouped round above, in order. */
function nativeRoundsOptions(rounds: number): Parameters<GoogleProvider["generate"]>[1] {
  const base = groupedRoundOptions();
  const round = base?.priorRound;
  if (round === undefined) throw new Error("the grouped round fixture is missing");
  return {
    tools: base?.tools,
    toolChoice: { type: "auto" },
    nativeConversation: { initialPrompt: "test prompt", turns: [], rounds: Array(rounds).fill(round) },
  };
}

Deno.test("GoogleProvider.attemptGenerate with nativeConversation replays a completed round as one model turn and one grouped functionResponse message", async () => {
  registerGoogleNativeMetadata();
  const body = await capturedBodyOf(nativeRoundsOptions(1));
  const contents = body.contents ?? [];
  assertEquals(contents.length, 3);
  assertEquals(contents[1].role, "model");
  assertEquals(contents[1].parts as JSONValue[], GOOGLE_ROUND_PARTS);
  assertEquals(contents[2].role, "user");
  assertEquals(contents[2].parts.length, 2);
  assertEquals(contents[2].parts[0].functionResponse?.response.content, "A-CONTENT");
  assertEquals(contents[2].parts[1].functionResponse?.response.content, "B-CONTENT");
});

Deno.test("GoogleProvider.attemptGenerate with nativeConversation replays two completed rounds in order before the next call", async () => {
  registerGoogleNativeMetadata();
  const body = await capturedBodyOf(nativeRoundsOptions(2));
  const contents = body.contents ?? [];
  assertEquals(contents.length, 5);
  assertEquals(contents[1].role, "model");
  assertEquals(contents[3].role, "model");
  assertEquals(contents[3].parts as JSONValue[], GOOGLE_ROUND_PARTS);
});

Deno.test("GoogleProvider.measureInputTokens counts the replayed rounds of a native conversation", async () => {
  const provider = new GoogleProvider({ apiKey: "test-key" });
  const bare = await provider.measureInputTokens!("test prompt", { toolChoice: { type: "auto" } });
  const replayed = await provider.measureInputTokens!("test prompt", nativeRoundsOptions(1));
  assert(replayed.sections.loopHistory > 0, "a replayed round is loop history");
  assert(replayed.totalTokens > bare.totalTokens, "the replayed rounds add to the total");
});

Deno.test("GoogleProvider.attemptGenerate with priorRound asks for a text answer after the grouped functionResponses when tool choice is none", async () => {
  const body = await capturedBodyOf(groupedRoundOptions("none"));
  const finalUser = body.contents?.[2].parts ?? [];
  assertEquals(finalUser.length, 3);
  assertEquals(finalUser[2].text, "Answer now in text only. Do not call any tool.");
});

Deno.test("GoogleProvider.attemptGenerate exposes the complete response parts as nativeAssistantReplay in original order", async () => {
  const provider = new GoogleProvider({ apiKey: "test-key" });
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: GOOGLE_ROUND_PARTS } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const result = await provider.generate("test prompt", { tools: [{ name: "read_file", inputSchema: {} }] });
    assertEquals(result.nativeAssistantReplay, { provider: "google", parts: GOOGLE_ROUND_PARTS });
    assertEquals(result.toolCalls?.map((call) => call.thoughtSignature), ["sig-a", undefined]);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("GoogleProvider.attemptGenerate: a one-call priorRound and the same call as priorTurn produce identical request bodies", async () => {
  const call = {
    toolUseId: "call-1",
    toolName: "read_file",
    toolInput: { path: "a.txt" },
    toolResultContent: "A",
    toolResultIsError: false,
    thoughtSignature: "sig-a",
  };
  const legacyBody = await capturedBodyOf({
    tools: [{ name: "read_file", inputSchema: { type: "object", properties: {} } }],
    toolChoice: { type: "auto" },
    priorTurn: call,
  });
  const groupedBody = await capturedBodyOf({
    tools: [{ name: "read_file", inputSchema: { type: "object", properties: {} } }],
    toolChoice: { type: "auto" },
    priorRound: {
      assistant: {
        provider: "google",
        parts: [{ functionCall: { name: "read_file", args: { path: "a.txt" } }, thoughtSignature: "sig-a" }],
      },
      calls: [{
        toolUseId: "call-1",
        index: 0,
        toolName: "read_file",
        toolInput: { path: "a.txt" },
        thoughtSignature: "sig-a",
        toolResultContent: "A",
        toolResultIsError: false,
      }],
    },
  });
  assertEquals(groupedBody, legacyBody);
});

Deno.test("GoogleProvider sends no parallel-disable field, even when the loop asks for one", async () => {
  const body = await capturedBodyOf({
    tools: [{ name: "read_file", description: "Read one file", inputSchema: { type: "object" } }],
    toolChoice: { type: "auto", disable_parallel_tool_use: true },
  });
  const serialized = JSON.stringify(body);
  assertFalse(serialized.includes("parallel"));
  assertFalse(serialized.includes("disable_parallel_tool_use"));
});
