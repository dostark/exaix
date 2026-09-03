/**
 * @module ReactLoopNativeToolsGateTest
 * @path packages/execution/tests/react_loop_native_tools_gate_test.ts
 * @description Tests the native-tools gate logic in ReActLoopStrategy. Verifies that
 * buildPrompt with skipToolProse=true omits only the FORMAT/TOML section (PGAP-2),
 * while always rendering AVAILABLE TOOLS and TOOL SELECTION GUIDELINES.
 */

import { assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "../src/strategies/react_loop_strategy.ts";
import type { IReActLoopExecutor } from "../src/react_loop_adapter.ts";

function dummyExecutor(): IReActLoopExecutor {
  return {} as never as IReActLoopExecutor;
}

Deno.test("buildPrompt with skipToolProse omits FORMAT and TOML but keeps AVAILABLE TOOLS and guidelines", () => {
  const strategy = new ReActLoopStrategy(dummyExecutor());
  const typed = strategy as never as {
    buildPrompt(
      blueprint: { name: string; capabilities: string[] },
      context: { trace_id: string; request: string; plan: string; portal: string },
      options: { agent_role: string; portal: string; permitted_tools?: string[] },
      history: Array<{ role: string; content: string }>,
      skipToolProse?: boolean,
    ): string;
  };

  const promptWithoutProse = typed.buildPrompt(
    { name: "test", capabilities: ["write"] },
    { trace_id: "t1", request: "req", plan: "plan", portal: "p" },
    { agent_role: "i", portal: "p" },
    [],
    true,
  );

  const promptWithProse = typed.buildPrompt(
    { name: "test", capabilities: ["write"] },
    { trace_id: "t1", request: "req", plan: "plan", portal: "p" },
    { agent_role: "i", portal: "p" },
    [],
    false,
  );

  // With skipToolProse: AVAILABLE TOOLS and TOOL SELECTION GUIDELINES are always present
  assertEquals(promptWithoutProse.includes("AVAILABLE TOOLS:"), true);
  assertEquals(promptWithoutProse.includes("TOOL SELECTION GUIDELINES:"), true);
  assertEquals(promptWithoutProse.includes("prefer patch_file over write_file"), true);

  // With skipToolProse: FORMAT and TOML block are omitted
  assertEquals(promptWithoutProse.includes("FORMAT:"), false);
  assertEquals(promptWithoutProse.includes("```toml"), false);

  // Without skipToolProse: all sections present
  assertEquals(promptWithProse.includes("AVAILABLE TOOLS:"), true);
  assertEquals(promptWithProse.includes("FORMAT:"), true);
  assertEquals(promptWithProse.includes("```toml"), true);
});
