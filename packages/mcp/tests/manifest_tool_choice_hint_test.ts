/**
 * @module ManifestToolChoiceHintTest
 * @path packages/mcp/tests/manifest_tool_choice_hint_test.ts
 * @description Phase 154 Step 5: `IToolManifestEntry.preferred_tool_choice_hint` is a new
 *   optional agent-facing string exposing Phase 151/152's "prefer patch_file for targeted
 *   edits" tool-selection guidance (already established in
 *   Blueprints/Skills/blueprint-best-practices.skill.md's "Precision" practice) through the
 *   MCP tool-definition surface, so external MCP clients get the same signal the internal
 *   ReAct loop already has via skill-file prose. Metadata only — Step 6 wires a runtime
 *   consumer.
 * @architectural-layer MCP
 * @related-files [packages/mcp/src/manifest.ts, packages/mcp/server/local_tool_dispatcher.ts]
 */
import { assertEquals } from "@std/assert";
import { TOOL_MANIFEST } from "@exaix/mcp/manifest.ts";
import { McpToolName } from "@exaix/mcp";

Deno.test("[manifest] write_file has a non-empty preferred_tool_choice_hint", () => {
  const entry = TOOL_MANIFEST.find((e) => e.name === McpToolName.WRITE_FILE);
  assertEquals(typeof entry?.preferred_tool_choice_hint, "string");
  assertEquals((entry?.preferred_tool_choice_hint?.length ?? 0) > 0, true);
});

Deno.test("[manifest] patch_file has a non-empty preferred_tool_choice_hint", () => {
  const entry = TOOL_MANIFEST.find((e) => e.name === McpToolName.PATCH_FILE);
  assertEquals(typeof entry?.preferred_tool_choice_hint, "string");
  assertEquals((entry?.preferred_tool_choice_hint?.length ?? 0) > 0, true);
});

Deno.test("[manifest] a tool with no hint set leaves preferred_tool_choice_hint undefined", () => {
  const entry = TOOL_MANIFEST.find((e) => e.name === McpToolName.READ_FILE);
  assertEquals(entry?.preferred_tool_choice_hint, undefined);
});
