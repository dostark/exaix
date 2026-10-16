/**
 * @module ReactLoopNativeToolsGateTest
 * @path packages/execution/tests/react_loop_native_tools_gate_test.ts
 * @description Tests the native-tools gate logic in ReActLoopStrategy. Verifies that
 * buildPrompt with skipToolProse=true omits only the FORMAT/TOML section (PGAP-2),
 * while always rendering AVAILABLE TOOLS and TOOL SELECTION GUIDELINES.
 */

import { assertFalse, assertStringIncludes } from "@std/assert";
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
  assertStringIncludes(promptWithoutProse, "AVAILABLE TOOLS:");
  assertStringIncludes(promptWithoutProse, "TOOL SELECTION GUIDELINES:");
  assertStringIncludes(promptWithoutProse, "prefer patch_file over write_file");

  // With skipToolProse: FORMAT and TOML block are omitted
  assertFalse(promptWithoutProse.includes("FORMAT:"));
  assertFalse(promptWithoutProse.includes("```toml"));

  // Without skipToolProse: all sections present
  assertStringIncludes(promptWithProse, "AVAILABLE TOOLS:");
  assertStringIncludes(promptWithProse, "FORMAT:");
  assertStringIncludes(promptWithProse, "```toml");
});

Deno.test("buildPrompt with skipToolProse tells the model not to repeat a finished tool call", () => {
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

  const prompt = typed.buildPrompt(
    { name: "test", capabilities: ["write"] },
    { trace_id: "t1", request: "req", plan: "plan", portal: "p" },
    { agent_role: "i", portal: "p" },
    [],
    true,
  );

  assertStringIncludes(prompt, "Do not repeat a tool call whose result is already in the history.");
  assertStringIncludes(prompt, "every file it names has been read");
  assertStringIncludes(prompt, "stop calling tools");
});
