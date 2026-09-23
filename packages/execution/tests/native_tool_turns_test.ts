/**
 * @module NativeToolTurnsTest
 * @path packages/execution/tests/native_tool_turns_test.ts
 * @description Tests for the shared native-tool primitives extracted from ReActLoopStrategy
 *   (Phase 199 GAP-13): buildNativeToolDefinitions, buildPriorTurn, enrichPortalPathParam,
 *   providerSupportsNativeTools.
 * @architectural-layer Test
 * @related-files [packages/execution/src/native_tool_turns.ts, packages/execution/src/strategies/react_loop_strategy.ts]
 */

import { assertEquals } from "@std/assert";
import {
  buildNativeToolDefinitions,
  buildPriorTurn,
  enrichPortalPathParam,
  providerSupportsNativeTools,
} from "../src/native_tool_turns.ts";
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
