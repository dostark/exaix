/**
 * @module ToolManifestDocsVisibilityTest
 * @path packages-team/mcp-server/tests/tool_manifest_docs_visibility_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Verifies that docs-visible tools in the canonical manifest are exactly the live
 * MCP tools intended for TOOLS.md, and that internal-only tools are excluded from docs generation.
 */

import { assertEquals } from "@std/assert";
import { McpToolName } from "@exaix/mcp";
import { TOOL_MANIFEST, ToolKind } from "@exaix/mcp";

const EXPECTED_DOCS_VISIBLE_TOOLS: string[] = [
  McpToolName.READ_FILE,
  McpToolName.WRITE_FILE,
  McpToolName.PATCH_FILE,
  McpToolName.DELETE_FILE,
  McpToolName.MOVE_FILE,
  McpToolName.CREATE_DIRECTORY,
  McpToolName.LIST_DIRECTORY,
  McpToolName.SEARCH_FILES,
  McpToolName.GIT_CREATE_BRANCH,
  McpToolName.GIT_COMMIT,
  McpToolName.GIT_STATUS,
  McpToolName.GIT_LOG,
  McpToolName.GIT_WORKTREE,
  McpToolName.RUN_COMMAND,
  McpToolName.CREATE_REQUEST,
  McpToolName.LIST_PLANS,
  McpToolName.APPROVE_PLAN,
  McpToolName.QUERY_JOURNAL,
  McpToolName.CONFIG_GET,
  McpToolName.CONFIG_SET,
  McpToolName.CONFIG_VALIDATE,
  McpToolName.CONFIG_DIFF,
  McpToolName.CONFIG_GET_PROVENANCE,
  McpToolName.CONFIG_APPLY,
];

Deno.test("ToolManifestDocsVisibility: docs-visible tools exactly match expected live MCP surface", () => {
  const docsVisibleNames = TOOL_MANIFEST
    .filter((e) => e.docs_visible)
    .map((e) => e.name)
    .sort();
  const expectedSorted = [...EXPECTED_DOCS_VISIBLE_TOOLS].sort();

  assertEquals(
    docsVisibleNames,
    expectedSorted,
    "docs_visible tools in manifest do not match the expected live MCP tool surface",
  );
});

Deno.test("ToolManifestDocsVisibility: all docs-visible entries are live MCP kind", () => {
  const docsVisibleEntries = TOOL_MANIFEST.filter((e) => e.docs_visible);
  for (const entry of docsVisibleEntries) {
    assertEquals(
      entry.kind === ToolKind.MCP_HANDLER || entry.kind === ToolKind.MCP_DOMAIN,
      true,
      `docs_visible entry '${entry.name}' has unexpected kind '${entry.kind}'`,
    );
  }
});

Deno.test("ToolManifestDocsVisibility: FETCH_URL and GIT are not in manifest as MCP tools", () => {
  const mcpNames = TOOL_MANIFEST
    .filter((e) => e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN)
    .map((e) => e.name);

  assertEquals(
    mcpNames.includes("FETCH_URL"),
    false,
    "Stale FETCH_URL should not be a live MCP tool in the manifest",
  );
  assertEquals(
    mcpNames.includes("git"),
    false,
    "Stale GIT='git' should not be a live MCP tool in the manifest",
  );
});
