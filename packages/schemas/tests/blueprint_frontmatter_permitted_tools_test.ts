/**
 * @module BlueprintFrontmatterSchemaPermittedToolsTest
 * @path packages/schemas/tests/blueprint_frontmatter_permitted_tools_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Verifies BlueprintFrontmatterSchema supports permitted_tools field for Phase 56 dynamic tool selection.
 */

import { McpToolName } from "@exaix/mcp";
import { ToolName } from "@exaix/core";

import { assertEquals, assertThrows } from "@std/assert";
import { BlueprintFrontmatterSchema } from "@exaix/schemas/blueprint.ts";

Deno.test("BlueprintFrontmatterSchema: accepts permitted_tools array", () => {
  const frontmatter = {
    agent_role: "senior-coder",
    name: "Senior Coder",
    model: "anthropic:claude-opus-4-5",
    created: new Date().toISOString(),
    created_by: "test-user",
    permitted_tools: [
      McpToolName.READ_FILE,
      McpToolName.LIST_DIRECTORY,
      McpToolName.SEARCH_FILES,
    ],
  };

  const result = BlueprintFrontmatterSchema.parse(frontmatter);

  assertEquals(result.permitted_tools, [
    McpToolName.READ_FILE,
    McpToolName.LIST_DIRECTORY,
    McpToolName.SEARCH_FILES,
  ]);
});

Deno.test("BlueprintFrontmatterSchema: accepts empty permitted_tools", () => {
  const frontmatter = {
    agent_role: "senior-coder",
    name: "Senior Coder",
    model: "anthropic:claude-opus-4-5",
    created: new Date().toISOString(),
    created_by: "test-user",
    permitted_tools: [],
  };

  const result = BlueprintFrontmatterSchema.parse(frontmatter);

  assertEquals(result.permitted_tools, []);
});

Deno.test("BlueprintFrontmatterSchema: accepts frontmatter without permitted_tools", () => {
  const frontmatter = {
    agent_role: "senior-coder",
    name: "Senior Coder",
    model: "anthropic:claude-opus-4-5",
    created: new Date().toISOString(),
    created_by: "test-user",
    // No permitted_tools specified
  };

  const result = BlueprintFrontmatterSchema.parse(frontmatter);

  // permitted_tools should be undefined when not specified
  assertEquals(result.permitted_tools, undefined);
});

Deno.test("BlueprintFrontmatterSchema: rejects invalid tool in permitted_tools", () => {
  const frontmatter = {
    agent_role: "senior-coder",
    name: "Senior Coder",
    model: "anthropic:claude-opus-4-5",
    created: new Date().toISOString(),
    created_by: "test-user",
    permitted_tools: ["invalid_tool"],
  };

  assertThrows(() => BlueprintFrontmatterSchema.parse(frontmatter));
});

Deno.test("BlueprintFrontmatterSchema: strips unknown fields", () => {
  const frontmatter = {
    agent_role: "senior-coder",
    name: "Senior Coder",
    model: "anthropic:claude-opus-4-5",
    created: new Date().toISOString(),
    created_by: "test-user",
    unknown_field: "should be stripped",
  };

  const result = BlueprintFrontmatterSchema.parse(frontmatter);

  assertEquals("unknown_field" in result, false);
});

Deno.test("[schemas] a blueprint permitted_tools entry of grep parses to the current ToolName.GREP_SEARCH value; an unknown name still fails validation", () => {
  const frontmatter = {
    agent_role: "senior-coder",
    name: "Senior Coder",
    model: "mock:test",
    created: new Date().toISOString(),
    created_by: "test-user",
    permitted_tools: ["read", "grep"],
  };
  const parsed = BlueprintFrontmatterSchema.parse(frontmatter);
  assertEquals(parsed.permitted_tools, [ToolName.READ_FILE, ToolName.GREP_SEARCH]);
  assertThrows(() => BlueprintFrontmatterSchema.parse({ ...frontmatter, permitted_tools: ["not-a-tool"] }));
  assertThrows(() => BlueprintFrontmatterSchema.parse({ ...frontmatter, permitted_tools: ["list_symbols"] }));
});
