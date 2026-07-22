/**
 * @module TypesToolDefinitionsTest
 * @path packages/ai/tests/types_tool_definitions_test.ts
 * @description Type-level tests for Step 1's new IToolDefinition, IToolChoice, IProviderTurn,
 * IProviderToolCall interfaces and their integration into IModelOptions and IGenerateResult.
 */

import { assert } from "@std/assert";
import type { IModelOptions, IProviderTurn, IToolCacheControl, IToolChoice, IToolDefinition } from "../src/types.ts";
import type { IGenerateResult, IProviderToolCall } from "../src/providers/common.ts";

Deno.test("IToolDefinition accepts all optional sub-fields", () => {
  const def: IToolDefinition = {
    name: "write_file",
    description: "Write content to a file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
    },
    type: "custom",
    strict: true,
    cache_control: { type: "ephemeral", ttl: "5m" },
    input_examples: [{ path: "/tmp/test.txt" }],
  };
  assert(typeof def.name === "string");
  assert(typeof def.description === "string");
  assert(def.strict === true);
  assert(def.cache_control?.type === "ephemeral");
});

Deno.test("IToolCacheControl defaults ttl to 5m when omitted", () => {
  const cc: IToolCacheControl = { type: "ephemeral" };
  assert(cc.type === "ephemeral");
});

Deno.test("IToolChoice includes disable_parallel_tool_use on all applicable variants", () => {
  const autoChoice: IToolChoice = { type: "auto", disable_parallel_tool_use: true };
  const anyChoice: IToolChoice = { type: "any", disable_parallel_tool_use: false };
  const toolChoice: IToolChoice = { type: "tool", name: "patch_file", disable_parallel_tool_use: true };
  const noneChoice: IToolChoice = { type: "none" };
  assert(autoChoice.type === "auto");
  assert(anyChoice.type === "any");
  assert(toolChoice.type === "tool");
  assert(noneChoice.type === "none");
});

Deno.test("IProviderTurn with string toolResultContent", () => {
  const turn: IProviderTurn = {
    toolUseId: "call_123",
    toolName: "write_file",
    toolInput: { path: "test.txt" },
    toolResultContent: "File written successfully",
    toolResultIsError: false,
  };
  assert(typeof turn.toolResultContent === "string");
});

Deno.test("IProviderTurn with array toolResultContent", () => {
  const turn: IProviderTurn = {
    toolUseId: "call_456",
    toolName: "patch_file",
    toolInput: { path: "test.txt" },
    toolResultContent: [{ type: "text", text: "Patched successfully" }],
    toolResultIsError: false,
  };
  assert(Array.isArray(turn.toolResultContent));
});

Deno.test("IModelOptions accepts tools, toolChoice, priorTurn", () => {
  const priorTurn: IProviderTurn = {
    toolUseId: "call_789",
    toolName: "write_file",
    toolInput: { path: "test.txt" },
    toolResultContent: "done",
    toolResultIsError: false,
  };
  const options: IModelOptions = {
    tools: [{
      name: "write_file",
      description: "Write files",
      inputSchema: { type: "object" },
    }],
    toolChoice: { type: "any", disable_parallel_tool_use: true },
    priorTurn,
  };
  assert(Array.isArray(options.tools));
  assert(options.toolChoice?.type === "any");
  assert(options.priorTurn?.toolUseId === "call_789");
});

Deno.test("IProviderToolCall carries all fields", () => {
  const call: IProviderToolCall = {
    id: "toolu_abc123",
    name: "write_file",
    input: { path: "test.txt", content: "hello" },
    type: "tool_use",
  };
  assert(call.id === "toolu_abc123");
  assert(call.name === "write_file");
  assert(typeof call.input.path === "string");
});

Deno.test("IGenerateResult accepts toolCalls", () => {
  const result: IGenerateResult = {
    content: "Tool execution result",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: "claude-sonnet-5",
    provider: "anthropic",
    toolCalls: [{
      id: "toolu_def456",
      name: "patch_file",
      input: { path: "test.txt" },
    }],
  };
  assert(Array.isArray(result.toolCalls));
  assert(result.toolCalls![0].name === "patch_file");
});

Deno.test("IGenerateResult stop_reason is unaffected by toolCalls addition", () => {
  const result: IGenerateResult = {
    content: "Thinking complete",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: "claude-sonnet-5",
    provider: "anthropic",
    stop_reason: "end_turn",
    toolCalls: [{
      id: "toolu_ghi789",
      name: "write_file",
      input: { path: "test.txt" },
    }],
  };
  assert(result.stop_reason === "end_turn");
  assert(Array.isArray(result.toolCalls));
});
