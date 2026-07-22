/**
 * @module ReactLoopNativeToolsGateTest
 * @path packages/execution/tests/react_loop_native_tools_gate_test.ts
 * @description Tests the native-tools gate logic in ReActLoopStrategy. Verifies that
 * buildPrompt respects skipToolProse and that the gateway metadata check works.
 */

import { assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "../src/strategies/react_loop_strategy.ts";
import type { IReActLoopExecutor } from "../src/react_loop_adapter.ts";

function dummyExecutor(): IReActLoopExecutor {
  return {} as never as IReActLoopExecutor;
}

Deno.test("buildPrompt with skipToolProse omits AVAILABLE TOOLS and FORMAT sections", () => {
  const strategy = new ReActLoopStrategy(dummyExecutor());
  const typed = strategy as never as {
    buildPrompt(
      blueprint: { name: string; capabilities: string[] },
      context: { trace_id: string; request: string; plan: string; portal: string },
      options: { identity_id: string; portal: string; permitted_tools?: string[] },
      history: Array<{ role: string; content: string }>,
      skipToolProse?: boolean,
    ): string;
  };

  const promptWithoutProse = typed.buildPrompt(
    { name: "test", capabilities: ["write"] },
    { trace_id: "t1", request: "req", plan: "plan", portal: "p" },
    { identity_id: "i", portal: "p" },
    [],
    true,
  );

  const promptWithProse = typed.buildPrompt(
    { name: "test", capabilities: ["write"] },
    { trace_id: "t1", request: "req", plan: "plan", portal: "p" },
    { identity_id: "i", portal: "p" },
    [],
    false,
  );

  // With skipToolProse: no AVAILABLE TOOLS or FORMAT section
  assertEquals(promptWithoutProse.includes("AVAILABLE TOOLS:"), false);
  assertEquals(promptWithoutProse.includes("FORMAT:"), false);
  assertEquals(promptWithoutProse.includes("```toml"), false);

  // Without skipToolProse: has the tool prose
  assertEquals(promptWithProse.includes("AVAILABLE TOOLS:"), true);
  assertEquals(promptWithProse.includes("FORMAT:"), true);
  assertEquals(promptWithProse.includes("```toml"), true);
});
