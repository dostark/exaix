/**
 * @module ReactLoopBuildNativeToolDefinitionsTest
 * @path packages/execution/tests/react_loop_build_native_tool_definitions_test.ts
 * @description Tests for ReActLoopStrategy.buildNativeToolDefinitions — verifies ITool[]
 * maps to IToolDefinition[] and nativeDescription overrides description (PGAP-1).
 */

import { assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "../src/strategies/react_loop_strategy.ts";
import type { ITool } from "@exaix/core/types";
import type { IReActLoopExecutor } from "../src/react_loop_adapter.ts";

const dummyExecutor: IReActLoopExecutor = {} as never;

Deno.test("buildNativeToolDefinitions maps write_file tool correctly", () => {
  const strategy = new ReActLoopStrategy(dummyExecutor);
  const typed = strategy as never as {
    buildNativeToolDefinitions(tools: ITool[]): Array<{ name: string }>;
  };

  const tools: ITool[] = [
    {
      name: "write_file",
      description: "Write content to a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          content: { type: "string", description: "File content" },
        },
        required: ["path", "content"],
      },
    },
  ];

  const result = typed.buildNativeToolDefinitions(tools) as Array<{
    name: string;
    description?: string;
    inputSchema: { type: string };
  }>;
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "write_file");
  assertEquals(result[0].description, "Write content to a file");
  assertEquals(result[0].inputSchema.type, "object");
});

Deno.test("buildNativeToolDefinitions maps multiple tools", () => {
  const strategy = new ReActLoopStrategy(dummyExecutor);
  const typed = strategy as never as {
    buildNativeToolDefinitions(tools: ITool[]): Array<{ name: string }>;
  };

  const tools: ITool[] = [
    { name: "write_file", description: "Write", parameters: { type: "object", properties: {} } },
    { name: "patch_file", description: "Patch", parameters: { type: "object", properties: {} } },
    { name: "read_file", description: "Read", parameters: { type: "object", properties: {} } },
  ];

  const result = typed.buildNativeToolDefinitions(tools);
  assertEquals(result.length, 3);
  assertEquals(result[0].name, "write_file");
  assertEquals(result[1].name, "patch_file");
  assertEquals(result[2].name, "read_file");
});

// PGAP-1: nativeDescription overrides description when present
Deno.test("buildNativeToolDefinitions uses nativeDescription when available", () => {
  const strategy = new ReActLoopStrategy(dummyExecutor);
  const typed = strategy as never as {
    buildNativeToolDefinitions(tools: ITool[]): Array<{ name: string; description?: string }>;
  };

  const tools: ITool[] = [
    {
      name: "patch_file",
      description: "TOML-prose description for patch_file",
      nativeDescription: "PREFERRED for targeted edits — native tool UI hint",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "read_file",
      description: "TOML-prose description for read_file",
      // No nativeDescription — falls back to description
      parameters: { type: "object", properties: {} },
    },
  ];

  const result = typed.buildNativeToolDefinitions(tools);
  assertEquals(result.length, 2);
  // patch_file uses nativeDescription
  assertEquals(result[0].name, "patch_file");
  assertEquals(result[0].description, "PREFERRED for targeted edits — native tool UI hint");
  // read_file falls back to regular description
  assertEquals(result[1].name, "read_file");
  assertEquals(result[1].description, "TOML-prose description for read_file");
});
