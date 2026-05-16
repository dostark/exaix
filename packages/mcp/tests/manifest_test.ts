/**
 * @module McpManifestTest
 * @path packages/mcp/tests/manifest_test.ts
 * @description Unit tests for the canonical TOOL_MANIFEST data — structure, classification
 * invariants, and DYNAMIC_MODE_TOOLS derivation. These are pure data tests that execute
 * without an MCPServer or filesystem, so they run fast and in isolation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/src/manifest.ts, packages/mcp/src/enums.ts]
 */
import { assert, assertEquals, assertExists } from "@std/assert";
import { DYNAMIC_MODE_TOOLS, TOOL_MANIFEST, ToolCategory, ToolKind, ToolSideEffectScope } from "@exaix/mcp";
import type { IToolManifestEntry } from "@exaix/mcp";

// ──────────────────────────────────────────────────────────────────────────────
// Structural invariants

Deno.test("[McpManifest] every entry has required fields with non-empty values", () => {
  for (const entry of TOOL_MANIFEST) {
    assert(entry.name.length > 0, `entry missing name: ${JSON.stringify(entry)}`);
    assert(entry.description.length > 0, `tool '${entry.name}' has empty description`);
    assertExists(entry.kind, `tool '${entry.name}' missing kind`);
    assertExists(entry.category, `tool '${entry.name}' missing category`);
    assertExists(entry.side_effect_scope, `tool '${entry.name}' missing side_effect_scope`);
  }
});

Deno.test("[McpManifest] tool names are unique across the manifest", () => {
  const names = TOOL_MANIFEST.map((e: IToolManifestEntry) => e.name);
  const unique = new Set(names);
  assertEquals(
    names.length,
    unique.size,
    `Duplicate tool names found: ${names.filter((n: string, i: number) => names.indexOf(n) !== i)}`,
  );
});

Deno.test("[McpManifest] total entry count is 21", () => {
  assertEquals(TOOL_MANIFEST.length, 21, "Expected 21 total tool entries in TOOL_MANIFEST");
});

// ──────────────────────────────────────────────────────────────────────────────
// Live MCP tools

Deno.test("[McpManifest] 12 MCP_HANDLER entries exist", () => {
  const handlers = TOOL_MANIFEST.filter((e) => e.kind === ToolKind.MCP_HANDLER);
  assertEquals(handlers.length, 12, `Expected 12 MCP_HANDLER entries, got ${handlers.length}`);
});

Deno.test("[McpManifest] 4 MCP_DOMAIN entries exist", () => {
  const domain = TOOL_MANIFEST.filter((e) => e.kind === ToolKind.MCP_DOMAIN);
  assertEquals(domain.length, 4, `Expected 4 MCP_DOMAIN entries, got ${domain.length}`);
});

Deno.test("[McpManifest] 5 INTERNAL_ONLY entries exist", () => {
  const internal = TOOL_MANIFEST.filter((e) => e.kind === ToolKind.INTERNAL_ONLY);
  assertEquals(internal.length, 5, `Expected 5 INTERNAL_ONLY entries, got ${internal.length}`);
});

// ──────────────────────────────────────────────────────────────────────────────
// Classification policy

Deno.test("[McpManifest] INTERNAL_ONLY tools are never docs_visible", () => {
  const violations = TOOL_MANIFEST
    .filter((e) => e.kind === ToolKind.INTERNAL_ONLY && e.docs_visible);
  assertEquals(violations, [], "INTERNAL_ONLY tools must not be docs_visible");
});

Deno.test("[McpManifest] INTERNAL_ONLY tools are never dynamic_mode_allowed", () => {
  const violations = TOOL_MANIFEST
    .filter((e) => e.kind === ToolKind.INTERNAL_ONLY && e.dynamic_mode_allowed);
  assertEquals(violations, [], "INTERNAL_ONLY tools must not be dynamic_mode_allowed");
});

Deno.test("[McpManifest] mutating tools (PORTAL/SYSTEM scope) are not parallel_safe", () => {
  const violations = TOOL_MANIFEST.filter(
    (e) =>
      (e.side_effect_scope === ToolSideEffectScope.PORTAL ||
        e.side_effect_scope === ToolSideEffectScope.SYSTEM) &&
      e.parallel_safe,
  );
  assertEquals(violations.map((e) => e.name), [], "PORTAL/SYSTEM-scope tools must not be parallel_safe");
});

Deno.test("[McpManifest] read-category tools with NONE scope are parallel_safe", () => {
  const violations = TOOL_MANIFEST.filter(
    (e) =>
      e.category === ToolCategory.READ &&
      e.side_effect_scope === ToolSideEffectScope.NONE &&
      !e.parallel_safe,
  );
  assertEquals(violations.map((e) => e.name), [], "Read-only NONE-scope tools must be parallel_safe");
});

Deno.test("[McpManifest] requires_human_approval tools are not dynamic_mode_allowed", () => {
  const violations = TOOL_MANIFEST.filter(
    (e) => e.requires_human_approval && e.dynamic_mode_allowed,
  );
  assertEquals(violations.map((e) => e.name), [], "Human-approval tools must not be dynamic_mode_allowed");
});

// ──────────────────────────────────────────────────────────────────────────────
// DYNAMIC_MODE_TOOLS derivation

Deno.test("[McpManifest] DYNAMIC_MODE_TOOLS matches manifest filter", () => {
  const expected = new Set(
    TOOL_MANIFEST
      .filter((e) => e.dynamic_mode_allowed && !e.requires_human_approval)
      .map((e) => e.name),
  );
  assertEquals(
    [...DYNAMIC_MODE_TOOLS].sort(),
    [...expected].sort(),
    "DYNAMIC_MODE_TOOLS must exactly equal manifest-derived set",
  );
});

Deno.test("[McpManifest] DYNAMIC_MODE_TOOLS contains expected 6 tools", () => {
  const expected = [
    "read_file",
    "list_directory",
    "git_status",
    "search_files",
    "exaix_list_plans",
    "exaix_query_journal",
  ];
  assertEquals(
    [...DYNAMIC_MODE_TOOLS].sort(),
    expected.sort(),
    "DYNAMIC_MODE_TOOLS must contain exactly the 6 approved dynamic tools",
  );
});
