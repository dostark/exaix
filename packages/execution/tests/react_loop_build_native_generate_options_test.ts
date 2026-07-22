/**
 * @module ReactLoopBuildNativeGenerateOptionsTest
 * @path packages/execution/tests/react_loop_build_native_generate_options_test.ts
 * @description Tests for ReActLoopStrategy.buildNativeGenerateOptions — verifies PGAP-3
 * heuristic: when nativePreferredTool is set and no priorTurn exists, tool_choice should
 * use {type: "tool", name: preferredTool} instead of {type: "any"}.
 */

import { assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "../src/strategies/react_loop_strategy.ts";
import type { IReActLoopExecutor } from "../src/react_loop_adapter.ts";

const dummyExecutor: IReActLoopExecutor = {} as never;

interface MockToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, string>;
}

interface MockGenerateOptions {
  tools?: MockToolDef[];
  toolChoice?: { type: string; name?: string };
}

interface MockPriorTurn {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, string>;
  toolResultContent: string;
  toolResultIsError: boolean;
}

Deno.test("buildNativeGenerateOptions with preferredTool uses tool_choice type:tool on first iteration", () => {
  const strategy = new ReActLoopStrategy(dummyExecutor);
  const typed = strategy as never as {
    buildNativeGenerateOptions(
      toolDefinitions?: MockToolDef[],
      priorTurn?: MockPriorTurn,
      nativeToolsUsed?: boolean,
      preferredTool?: string,
    ): MockGenerateOptions;
  };

  const options = typed.buildNativeGenerateOptions(
    [{ name: "patch_file", description: "Patch", inputSchema: { type: "object" } }],
    undefined,
    true,
    "patch_file",
  );

  assertEquals(options.toolChoice?.type, "tool");
  assertEquals(options.toolChoice?.name, "patch_file");
});

Deno.test("buildNativeGenerateOptions with preferredTool falls back to type:any when priorTurn exists", () => {
  const strategy = new ReActLoopStrategy(dummyExecutor);
  const typed = strategy as never as {
    buildNativeGenerateOptions(
      toolDefinitions?: MockToolDef[],
      priorTurn?: MockPriorTurn,
      nativeToolsUsed?: boolean,
      preferredTool?: string,
    ): MockGenerateOptions;
  };

  const options = typed.buildNativeGenerateOptions(
    [{ name: "patch_file", description: "Patch", inputSchema: { type: "object" } }],
    { toolUseId: "call_1", toolName: "read_file", toolInput: {}, toolResultContent: "ok", toolResultIsError: false },
    true,
    "patch_file",
  );

  assertEquals(options.toolChoice?.type, "any");
  assertEquals(options.toolChoice?.name, undefined);
});

Deno.test("buildNativeGenerateOptions with preferredTool but no native tools active uses no tool_choice", () => {
  const strategy = new ReActLoopStrategy(dummyExecutor);
  const typed = strategy as never as {
    buildNativeGenerateOptions(
      toolDefinitions?: MockToolDef[],
      priorTurn?: MockPriorTurn,
      nativeToolsUsed?: boolean,
      preferredTool?: string,
    ): MockGenerateOptions;
  };

  const options = typed.buildNativeGenerateOptions(
    undefined,
    undefined,
    false,
    "patch_file",
  );

  assertEquals(options.toolChoice, undefined);
});

// PGAP-3: targeted-edit keyword detection
const TARGETED_EDIT_PATTERN = /fix|patch|null.guard|refactor|edit|bug|repair/i;

Deno.test("targeted-edit pattern matches 'fix bug' in plan context", () => {
  assertEquals(TARGETED_EDIT_PATTERN.test("Fix the null-guard bug in utils.ts"), true);
});

Deno.test("targeted-edit pattern matches 'patch config' in plan context", () => {
  assertEquals(TARGETED_EDIT_PATTERN.test("Patch the config value"), true);
});

Deno.test("targeted-edit pattern matches 'refactor extract function'", () => {
  assertEquals(TARGETED_EDIT_PATTERN.test("Refactor extract function into helper"), true);
});

Deno.test("targeted-edit pattern does NOT match 'read config file'", () => {
  assertEquals(TARGETED_EDIT_PATTERN.test("Read the config file"), false);
});

Deno.test("targeted-edit pattern does NOT match 'list directory contents'", () => {
  assertEquals(TARGETED_EDIT_PATTERN.test("List directory contents"), false);
});
