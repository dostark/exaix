/**
 * @module NativeToolTurnsTest
 * @path packages/execution/tests/native_tool_turns_test.ts
 * @description Tests for the shared native-tool primitives extracted from ReActLoopStrategy
 *   (Phase 199 GAP-13): buildNativeToolDefinitions, buildPriorTurn, enrichPortalPathParam,
 *   providerSupportsNativeTools.
 * @architectural-layer Test
 * @related-files [packages/execution/src/native_tool_turns.ts, packages/execution/src/strategies/react_loop_strategy.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  buildNativeToolDefinitions,
  buildPriorTurn,
  buildToolRound,
  enrichPortalPathParam,
  providerSupportsNativeTools,
  validateProviderRound,
} from "../src/native_tool_turns.ts";
import type { INativeRoundLimits } from "@exaix/ai/native_round_limits.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { ITool, IToolResult } from "@exaix/core/types";
import type { IProviderToolCall } from "@exaix/ai/providers";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { ProviderCostTier } from "@exaix/core";
import { PricingTier } from "@exaix/core";

Deno.test("[native_tool_turns] buildNativeToolDefinitions maps ITool[] to IToolDefinition[], preferring nativeDescription", () => {
  const tools: ITool[] = [
    { name: "read_file", description: "Read a file", parameters: { type: "object", properties: {} } },
    {
      name: "patch_file",
      description: "TOML-prose description",
      nativeDescription: "PREFERRED for targeted edits",
      parameters: { type: "object", properties: {} },
    },
  ];
  const defs = buildNativeToolDefinitions(tools);
  assertEquals(defs.length, 2);
  assertEquals(defs[0].name, "read_file");
  assertEquals(defs[0].description, "Read a file");
  assertEquals(defs[1].description, "PREFERRED for targeted edits");
});

Deno.test("[native_tool_turns] buildPriorTurn maps a successful result", () => {
  const call: IProviderToolCall = { id: "toolu_1", name: "read_file", input: { path: "a.ts" } };
  const result: IToolResult = { success: true, data: { content: "hi" } };
  const turn = buildPriorTurn(call, result);
  assertEquals(turn.toolUseId, "toolu_1");
  assertEquals(turn.toolName, "read_file");
  assertEquals(turn.toolResultIsError, false);
  assertEquals(typeof turn.toolResultContent, "string");
});

Deno.test("[native_tool_turns] buildPriorTurn maps a failed result with toolResultIsError=true", () => {
  const call: IProviderToolCall = { id: "toolu_2", name: "read_file", input: { path: "missing.ts" } };
  const result: IToolResult = { success: false, error: "not found" };
  const turn = buildPriorTurn(call, result);
  assertEquals(turn.toolResultIsError, true);
});

Deno.test("[native_tool_turns] buildPriorTurn forwards thinkingBlocks/thoughtSignature/reasoningContent verbatim", () => {
  const call: IProviderToolCall = {
    id: "toolu_3",
    name: "read_file",
    input: { path: "a.ts" },
    thoughtSignature: "gemini-sig",
    thinkingBlocks: [{ thinking: "considering", signature: "anthropic-sig" }],
    reasoningContent: "I will read it.",
  };
  const turn = buildPriorTurn(call, { success: true, data: {} });
  assertEquals(turn.thoughtSignature, "gemini-sig");
  assertEquals(turn.thinkingBlocks, [{ thinking: "considering", signature: "anthropic-sig" }]);
  assertEquals(turn.reasoningContent, "I will read it.");
});

Deno.test("[native_tool_turns] buildPriorTurn leaves replay artifacts undefined when the call carries none", () => {
  const call: IProviderToolCall = { id: "toolu_4", name: "read_file", input: { path: "a.ts" } };
  const turn = buildPriorTurn(call, { success: true, data: {} });
  assertEquals(turn.thoughtSignature, undefined);
  assertEquals(turn.thinkingBlocks, undefined);
  assertEquals(turn.reasoningContent, undefined);
});

Deno.test("[native_tool_turns] enrichPortalPathParam prefixes a bare path with @alias/", () => {
  const enriched = enrichPortalPathParam("read_file", { path: "src/a.ts" }, "myportal");
  assertEquals(enriched.path, "@myportal/src/a.ts");
});

Deno.test("[native_tool_turns] enrichPortalPathParam leaves an already @-prefixed path untouched", () => {
  const enriched = enrichPortalPathParam("read_file", { path: "@other/src/a.ts" }, "myportal");
  assertEquals(enriched.path, "@other/src/a.ts");
});

Deno.test("[native_tool_turns] enrichPortalPathParam exempts get_module_dependencies (portal-relative cached graph edges)", () => {
  const enriched = enrichPortalPathParam("get_module_dependencies", { path: "src/a.ts" }, "myportal");
  assertEquals(enriched.path, "src/a.ts");
});

Deno.test("[native_tool_turns] enrichPortalPathParam is a no-op when portalAlias is absent", () => {
  const enriched = enrichPortalPathParam("read_file", { path: "src/a.ts" }, undefined);
  assertEquals(enriched.path, "src/a.ts");
});

Deno.test("[native_tool_turns] providerSupportsNativeTools resolves a bare registered id", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("mock-native", { create: () => Promise.reject(new Error("unused")) } as never, {
    name: "mock-native",
    description: "fixture",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.MEDIUM,
    strengths: [],
    supportsNativeTools: true,
  });
  assertEquals(providerSupportsNativeTools("mock-native"), true);
});

Deno.test("[native_tool_turns] providerSupportsNativeTools resolves a composite id via the bare-type prefix fallback", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("anthropic", { create: () => Promise.reject(new Error("unused")) } as never, {
    name: "anthropic",
    description: "fixture",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.MEDIUM,
    strengths: [],
    supportsNativeTools: true,
  });
  assertEquals(providerSupportsNativeTools("anthropic-claude-x"), true);
});

Deno.test("[native_tool_turns] providerSupportsNativeTools returns false for an unregistered id", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  ProviderRegistry.clear();
  assertEquals(providerSupportsNativeTools("nonexistent-provider"), false);
});

Deno.test("[native_tool_turns] providerSupportsNativeTools returns false (never throws) for an undefined id", () => {
  assertEquals(providerSupportsNativeTools(undefined), false);
});

// Grouped replay: one completed provider response becomes one validated round.

const ROUND_LIMITS: INativeRoundLimits = {
  maxResponseCalls: 8,
  maxArgumentBytes: 1024,
  maxRoundReplayBytes: 65536,
};

/** A Gemini-shaped response: thought text, then three functionCall parts, signed on the first. */
function threeCallGoogleResponse(): IGenerateResult {
  const parts = [
    { text: "I will read two files and list one directory." },
    { functionCall: { name: "read_file", args: { path: "a.txt" } }, thoughtSignature: "sig-a" },
    { functionCall: { name: "read_file", args: { path: "b.txt" } } },
    { functionCall: { name: "list_directory", args: { path: "." } } },
  ];
  return {
    content: "",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: "gemini-test",
    provider: "google",
    toolCalls: [
      { id: "call-1", name: "read_file", input: { path: "a.txt" }, thoughtSignature: "sig-a" },
      { id: "call-2", name: "read_file", input: { path: "b.txt" } },
      { id: "call-3", name: "list_directory", input: { path: "." } },
    ],
    nativeAssistantReplay: { provider: "google", parts },
  };
}

const THREE_CALL_OUTCOMES = [
  { toolUseId: "call-1", toolResultContent: "A-CONTENT", toolResultIsError: false },
  { toolUseId: "call-2", toolResultContent: "B-CONTENT", toolResultIsError: false },
  { toolUseId: "call-3", toolResultContent: "DIR-CONTENT", toolResultIsError: false },
];

Deno.test("[native_tool_turns][round] validateProviderRound keeps original calls in order and the full assistant parts", () => {
  const round = validateProviderRound(threeCallGoogleResponse(), ROUND_LIMITS);
  assertEquals(round.calls.map((call) => call.id), ["call-1", "call-2", "call-3"]);
  assertEquals(round.calls.map((call) => call.index), [0, 1, 2]);
  assertEquals(round.calls[0].originalCall.thoughtSignature, "sig-a");
  assertEquals(round.assistant.provider, "google");
});

Deno.test("[native_tool_turns][round] buildToolRound joins three calls to their outcomes by id and index", () => {
  const round = buildToolRound(validateProviderRound(threeCallGoogleResponse(), ROUND_LIMITS), THREE_CALL_OUTCOMES);
  assertEquals(round.calls.map((entry) => entry.toolUseId), ["call-1", "call-2", "call-3"]);
  assertEquals(round.calls.map((entry) => entry.toolName), ["read_file", "read_file", "list_directory"]);
  assertEquals(round.calls.map((entry) => entry.toolResultContent), ["A-CONTENT", "B-CONTENT", "DIR-CONTENT"]);
  assertEquals(round.calls[0].thoughtSignature, "sig-a");
  assertEquals(round.calls[1].thoughtSignature, undefined);
});

Deno.test("[native_tool_turns][round] buildToolRound refuses a missing outcome instead of guessing by array index", () => {
  const round = validateProviderRound(threeCallGoogleResponse(), ROUND_LIMITS);
  assertThrows(() => buildToolRound(round, THREE_CALL_OUTCOMES.slice(0, 2)));
});

Deno.test("[native_tool_turns][round] buildToolRound refuses an extra outcome for an id the round never requested", () => {
  const round = validateProviderRound(threeCallGoogleResponse(), ROUND_LIMITS);
  const extra = [...THREE_CALL_OUTCOMES, { toolUseId: "call-9", toolResultContent: "X", toolResultIsError: false }];
  assertThrows(() => buildToolRound(round, extra));
});

Deno.test("[native_tool_turns][round] buildToolRound refuses a duplicate outcome for one id", () => {
  const round = validateProviderRound(threeCallGoogleResponse(), ROUND_LIMITS);
  const duplicate = [...THREE_CALL_OUTCOMES, THREE_CALL_OUTCOMES[0]];
  assertThrows(() => buildToolRound(round, duplicate));
});

Deno.test("[native_tool_turns][round] a refused signed call still gets one ordered error result and keeps its signature", () => {
  const round = validateProviderRound(threeCallGoogleResponse(), ROUND_LIMITS);
  const outcomes = [
    { toolUseId: "call-1", toolResultContent: "Refused: outside the portal", toolResultIsError: true },
    THREE_CALL_OUTCOMES[1],
    THREE_CALL_OUTCOMES[2],
  ];
  const built = buildToolRound(round, outcomes);
  assertEquals(built.calls[0].toolResultIsError, true);
  assertEquals(built.calls[0].thoughtSignature, "sig-a");
  assertEquals(built.calls.length, 3);
});

Deno.test("[native_tool_turns][round] validateProviderRound rejects an empty tool id before any effect", () => {
  const response = threeCallGoogleResponse();
  response.toolCalls![1] = { ...response.toolCalls![1], id: "   " };
  assertThrows(() => validateProviderRound(response, ROUND_LIMITS));
});

Deno.test("[native_tool_turns][round] validateProviderRound rejects duplicate ids across the response", () => {
  const response = threeCallGoogleResponse();
  response.toolCalls![2] = { ...response.toolCalls![2], id: "call-1" };
  assertThrows(() => validateProviderRound(response, ROUND_LIMITS));
});

Deno.test("[native_tool_turns][round] validateProviderRound rejects more calls than the accepted-round ceiling", () => {
  assertThrows(() => validateProviderRound(threeCallGoogleResponse(), { ...ROUND_LIMITS, maxResponseCalls: 2 }));
});

Deno.test("[native_tool_turns][round] validateProviderRound rejects arguments over the byte ceiling", () => {
  assertThrows(() => validateProviderRound(threeCallGoogleResponse(), { ...ROUND_LIMITS, maxArgumentBytes: 4 }));
});

Deno.test("[native_tool_turns][round] validateProviderRound rejects a round whose assistant parts do not match its calls", () => {
  const response = threeCallGoogleResponse();
  response.toolCalls = response.toolCalls!.slice(0, 2);
  assertThrows(() => validateProviderRound(response, ROUND_LIMITS));
});

Deno.test("[native_tool_turns][round] validateProviderRound rejects a signature on a call whose original part does not carry it", () => {
  const response = threeCallGoogleResponse();
  response.toolCalls![1] = { ...response.toolCalls![1], thoughtSignature: "sig-moved" };
  assertThrows(() => validateProviderRound(response, ROUND_LIMITS));
});

Deno.test("[native_tool_turns][round] validateProviderRound rejects a response without a replay carrier", () => {
  const response = threeCallGoogleResponse();
  delete response.nativeAssistantReplay;
  assertThrows(() => validateProviderRound(response, ROUND_LIMITS));
});

Deno.test("[native_tool_turns][round] buildToolRound replays an alias call under its original name and id", () => {
  const response: IGenerateResult = {
    content: "",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: "gemini-test",
    provider: "google",
    toolCalls: [{ id: "toolu_alias", name: "Read", input: { file_path: "a.ts" } }],
    nativeAssistantReplay: {
      provider: "google",
      parts: [{ functionCall: { name: "Read", args: { file_path: "a.ts" } } }],
    },
  };
  const built = buildToolRound(
    validateProviderRound(response, ROUND_LIMITS),
    [{ toolUseId: "toolu_alias", toolResultContent: "RESULT", toolResultIsError: false }],
  );
  assertEquals(built.calls[0].toolName, "Read");
  assertEquals(built.calls[0].toolUseId, "toolu_alias");
  assertEquals(built.calls[0].toolInput, { file_path: "a.ts" });
});

/** A two-call Anthropic response: thinking, text, then two tool_use blocks in order. */
function twoCallAnthropicResponse(): IGenerateResult {
  const blocks = [
    { type: "thinking", thinking: "Read both files.", signature: "sig-thinking" },
    { type: "text", text: "I will read both files." },
    { type: "tool_use", id: "toolu_a", name: "read_file", input: { path: "a.txt" } },
    { type: "tool_use", id: "toolu_b", name: "read_file", input: { path: "b.txt" } },
  ];
  return {
    content: "",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: "claude-test",
    provider: "anthropic",
    toolCalls: [
      { id: "toolu_a", name: "read_file", input: { path: "a.txt" } },
      { id: "toolu_b", name: "read_file", input: { path: "b.txt" } },
    ],
    nativeAssistantReplay: { provider: "anthropic", blocks },
  };
}

Deno.test("[native_tool_turns][round] validateProviderRound keeps the Anthropic blocks for replay and the calls in order", () => {
  const round = validateProviderRound(twoCallAnthropicResponse(), ROUND_LIMITS);
  assertEquals(round.calls.map((call) => call.id), ["toolu_a", "toolu_b"]);
  assertEquals(round.assistant.provider, "anthropic");
});

Deno.test("[native_tool_turns][round] validateProviderRound rejects an Anthropic call whose id does not match its tool_use block", () => {
  const response = twoCallAnthropicResponse();
  response.toolCalls![1] = { ...response.toolCalls![1], id: "toolu_other" };
  assertThrows(() => validateProviderRound(response, ROUND_LIMITS));
});

Deno.test("[native_tool_turns][round] validateProviderRound rejects an Anthropic call whose input differs from its tool_use block", () => {
  const response = twoCallAnthropicResponse();
  response.toolCalls![0] = { ...response.toolCalls![0], input: { path: "z.txt" } };
  assertThrows(() => validateProviderRound(response, ROUND_LIMITS));
});
