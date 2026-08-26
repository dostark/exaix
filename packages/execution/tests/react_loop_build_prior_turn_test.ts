/**
 * @module ReactLoopBuildPriorTurnTest
 * @path packages/execution/tests/react_loop_build_prior_turn_test.ts
 * @description Tests for ReActLoopStrategy.buildPriorTurn — verifies successful and failed
 * tool results map to IProviderTurn correctly.
 */

import { assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "../src/strategies/react_loop_strategy.ts";
import type { IReActLoopExecutor } from "../src/react_loop_adapter.ts";
import type { IToolResult } from "@exaix/core/types";

const dummyExecutor: IReActLoopExecutor = {} as never;

interface ProviderTurnResult {
  toolUseId: string;
  toolName: string;
  toolInput: { path?: string };
  toolResultContent: string;
  toolResultIsError: boolean;
  thoughtSignature?: string;
  thinkingBlocks?: Array<{ thinking: string; signature: string }>;
  reasoningContent?: string;
}

interface ProviderToolCallInput {
  id: string;
  name: string;
  input: { path?: string; content?: string };
  type?: string;
  thoughtSignature?: string;
  thinkingBlocks?: Array<{ thinking: string; signature: string }>;
  reasoningContent?: string;
}

Deno.test("buildPriorTurn maps successful tool result correctly", () => {
  const strategy = new ReActLoopStrategy(dummyExecutor);
  const typed = strategy as never as {
    buildPriorTurn(toolCall: ProviderToolCallInput, result: IToolResult): ProviderTurnResult;
  };

  const result = typed.buildPriorTurn(
    { id: "toolu_abc123", name: "write_file", input: { path: "/tmp/test.txt", content: "hello" }, type: "tool_use" },
    { success: true, data: { path: "/tmp/test.txt" } },
  );
  assertEquals(result.toolUseId, "toolu_abc123");
  assertEquals(result.toolName, "write_file");
  assertEquals(result.toolInput.path, "/tmp/test.txt");
  assertEquals(result.toolResultIsError, false);
  assertEquals(typeof result.toolResultContent, "string");
});

Deno.test("buildPriorTurn maps failed tool result correctly", () => {
  const strategy = new ReActLoopStrategy(dummyExecutor);
  const typed = strategy as never as {
    buildPriorTurn(toolCall: ProviderToolCallInput, result: IToolResult): ProviderTurnResult;
  };

  const result = typed.buildPriorTurn(
    { id: "toolu_def456", name: "patch_file", input: { path: "/tmp/test.txt" } },
    { success: false, error: "File not found" },
  );
  assertEquals(result.toolUseId, "toolu_def456");
  assertEquals(result.toolName, "patch_file");
  assertEquals(result.toolResultIsError, true);
  assertEquals(typeof result.toolResultContent, "string");
});

Deno.test("buildPriorTurn forwards the provider replay artifacts (thoughtSignature, thinkingBlocks, reasoningContent) to IProviderTurn", () => {
  const strategy = new ReActLoopStrategy(dummyExecutor);
  const typed = strategy as never as {
    buildPriorTurn(toolCall: ProviderToolCallInput, result: IToolResult): ProviderTurnResult;
  };

  const result = typed.buildPriorTurn(
    {
      id: "toolu_xyz789",
      name: "patch_file",
      input: { path: "/tmp/test.txt" },
      type: "tool_use",
      thoughtSignature: "gemini-sig",
      thinkingBlocks: [{ thinking: "Let me patch it.", signature: "anthropic-sig" }],
      reasoningContent: "I will apply the diff.",
    },
    { success: true, data: { path: "/tmp/test.txt" } },
  );
  assertEquals(result.thoughtSignature, "gemini-sig");
  assertEquals(result.thinkingBlocks, [{ thinking: "Let me patch it.", signature: "anthropic-sig" }]);
  assertEquals(result.reasoningContent, "I will apply the diff.");
});

Deno.test("buildPriorTurn leaves replay artifacts undefined when the tool call carries none", () => {
  const strategy = new ReActLoopStrategy(dummyExecutor);
  const typed = strategy as never as {
    buildPriorTurn(toolCall: ProviderToolCallInput, result: IToolResult): ProviderTurnResult;
  };

  const result = typed.buildPriorTurn(
    { id: "toolu_noartifact", name: "read_file", input: { path: "/tmp/test.txt" } },
    { success: true, data: { path: "/tmp/test.txt" } },
  );
  assertEquals(result.thoughtSignature, undefined);
  assertEquals(result.thinkingBlocks, undefined);
  assertEquals(result.reasoningContent, undefined);
});
