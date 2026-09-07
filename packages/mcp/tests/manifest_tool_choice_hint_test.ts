/**
 * @module ManifestToolChoiceHintTest
 * @path packages/mcp/tests/manifest_tool_choice_hint_test.ts
 * @description Phase 154 Step 5: `IToolManifestEntry.preferred_tool_choice_hint` is a new
 *   optional agent-facing string exposing Phase 151/152's "prefer patch_file for targeted
 *   edits" tool-selection guidance (already established in
 *   Blueprints/Skills/blueprint-best-practices.skill.md's "Precision" practice) through the
 *   MCP tool-definition surface, so external MCP clients get the same signal the internal
 *   ReAct loop already has via skill-file prose. Step 6 wires `appendToolChoiceHint()` (this
 *   file) into both `LocalToolDispatcher.getToolDefinitions()` and, more importantly, the
 *   real MCP server's `tools/list` response (`exaix-team/packages/mcp-server/tests/tool_choice_hint_e2e_test.ts`
 *   is the non-deferrable proof for the latter — `LocalToolDispatcher` is not what the real
 *   server's `tools/list` is built from).
 * @architectural-layer MCP
 * @related-files [packages/mcp/src/manifest.ts, packages/mcp/server/local_tool_dispatcher.ts, exaix-team/packages/mcp-server/server.ts]
 */
import { assertEquals } from "@std/assert";
import { TOOL_MANIFEST } from "@exaix/mcp/manifest.ts";
import { appendToolChoiceHint, McpToolName } from "@exaix/mcp";
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

Deno.test("[appendToolChoiceHint] appends the manifest hint to a base description with a clear delimiter", () => {
  const result = appendToolChoiceHint(McpToolName.PATCH_FILE, "Base description.");
  const hint = TOOL_MANIFEST.find((e) => e.name === McpToolName.PATCH_FILE)?.preferred_tool_choice_hint;
  assertEquals(result.startsWith("Base description."), true);
  assertEquals(result.includes(hint ?? "__missing_hint__"), true);
});

Deno.test("[appendToolChoiceHint] leaves the description unchanged for a tool with no hint set", () => {
  const result = appendToolChoiceHint(McpToolName.READ_FILE, "Base description.");
  assertEquals(result, "Base description.");
});

Deno.test("[appendToolChoiceHint] leaves the description unchanged for an unknown tool name", () => {
  const result = appendToolChoiceHint("unknown_tool", "Base description.");
  assertEquals(result, "Base description.");
});
