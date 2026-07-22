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
}

interface ProviderToolCallInput {
  id: string;
  name: string;
  input: { path?: string; content?: string };
  type?: string;
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
