/**
 * @module BlueprintFrontmatterSchemaPermittedToolsTest
 * @path packages/schemas/tests/blueprint_frontmatter_permitted_tools_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Verifies BlueprintFrontmatterSchema supports permitted_tools field for Phase 56 dynamic tool selection.
 */

import { McpToolName } from "@exaix/mcp";

import { assertEquals, assertThrows } from "@std/assert";
import { BlueprintFrontmatterSchema } from "@exaix/schemas/blueprint.ts";

Deno.test("BlueprintFrontmatterSchema: accepts permitted_tools array", () => {
  const frontmatter = {
    identity_id: "senior-coder",
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
    identity_id: "senior-coder",
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
    identity_id: "senior-coder",
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
    identity_id: "senior-coder",
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
    identity_id: "senior-coder",
    name: "Senior Coder",
    model: "anthropic:claude-opus-4-5",
    created: new Date().toISOString(),
    created_by: "test-user",
    unknown_field: "should be stripped",
  };

  const result = BlueprintFrontmatterSchema.parse(frontmatter);

  assertEquals("unknown_field" in result, false);
});
