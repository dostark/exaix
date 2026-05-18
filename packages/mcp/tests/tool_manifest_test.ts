/**
 * @module ToolManifestTest
 * @path packages/mcp/tests/tool_manifest_test.ts
 * @description Verifies that the canonical tool manifest is complete, unique, and well-formed
 * for all live MCP tools and internal-only tools.
 */

import { assertEquals, assertExists } from "@std/assert";
import { McpToolName } from "@exaix/mcp";
import { TOOL_MANIFEST, ToolKind } from "@exaix/mcp";
import type { IToolManifestEntry } from "@exaix/mcp";

const LIVE_MCP_TOOL_NAMES: string[] = [
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
  McpToolName.RUN_COMMAND,
  McpToolName.CREATE_REQUEST,
  McpToolName.LIST_PLANS,
  McpToolName.APPROVE_PLAN,
  McpToolName.QUERY_JOURNAL,
];

Deno.test("ToolManifest: all live MCP tools are present in the manifest", () => {
  const manifestNames = TOOL_MANIFEST.map((e) => e.name);
  for (const expected of LIVE_MCP_TOOL_NAMES) {
    assertEquals(
      manifestNames.includes(expected),
      true,
      `Live MCP tool '${expected}' is missing from TOOL_MANIFEST`,
    );
  }
});

Deno.test("ToolManifest: manifest contains no duplicate tool names", () => {
  const names = TOOL_MANIFEST.map((e) => e.name);
  const unique = new Set(names);
  assertEquals(unique.size, names.length, "TOOL_MANIFEST contains duplicate tool names");
});

Deno.test("ToolManifest: every entry has required fields", () => {
  for (const entry of TOOL_MANIFEST) {
    assertExists(entry.name, `Entry missing 'name'`);
    assertExists(entry.kind, `Entry ${entry.name} missing 'kind'`);
    assertExists(entry.category, `Entry ${entry.name} missing 'category'`);
    assertEquals(
      typeof entry.dynamic_mode_allowed,
      "boolean",
      `Entry ${entry.name} missing 'dynamic_mode_allowed'`,
    );
    assertEquals(
      typeof entry.requires_human_approval,
      "boolean",
      `Entry ${entry.name} missing 'requires_human_approval'`,
    );
    assertEquals(
      typeof entry.docs_visible,
      "boolean",
      `Entry ${entry.name} missing 'docs_visible'`,
    );
    assertExists(entry.description, `Entry ${entry.name} missing 'description'`);
    assertEquals(
      typeof entry.idempotent,
      "boolean",
      `Entry ${entry.name} missing 'idempotent'`,
    );
    assertExists(entry.side_effect_scope, `Entry ${entry.name} missing 'side_effect_scope'`);
    assertEquals(
      typeof entry.parallel_safe,
      "boolean",
      `Entry ${entry.name} missing 'parallel_safe'`,
    );
  }
});

Deno.test("ToolManifest: live MCP tools are docs_visible", () => {
  const liveMcpEntries = TOOL_MANIFEST.filter(
    (e) => e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN,
  );
  for (const entry of liveMcpEntries) {
    assertEquals(
      entry.docs_visible,
      true,
      `Live MCP tool '${entry.name}' should have docs_visible: true`,
    );
  }
});

Deno.test("ToolManifest: internal-only tools are not docs_visible", () => {
  const internalEntries = TOOL_MANIFEST.filter(
    (e) => e.kind === ToolKind.INTERNAL_ONLY,
  );
  for (const entry of internalEntries) {
    assertEquals(
      entry.docs_visible,
      false,
      `Internal tool '${entry.name}' should have docs_visible: false`,
    );
  }
});

Deno.test("ToolManifest: mutating domain tools require human approval", () => {
  const mutatingDomain = [McpToolName.CREATE_REQUEST, McpToolName.APPROVE_PLAN];
  for (const toolName of mutatingDomain) {
    const entry = TOOL_MANIFEST.find((e) => e.name === toolName);
    assertExists(entry, `Domain tool '${toolName}' not in manifest`);
    assertEquals(
      entry!.requires_human_approval,
      true,
      `Mutating domain tool '${toolName}' must have requires_human_approval: true`,
    );
    assertEquals(
      entry!.dynamic_mode_allowed,
      true,
      `Mutating domain tool '${toolName}' must have dynamic_mode_allowed: true so Phase 79 can gate it at runtime`,
    );
  }
});

Deno.test("ToolManifest: read-only domain tools do not require human approval", () => {
  const readOnlyDomain = [McpToolName.LIST_PLANS, McpToolName.QUERY_JOURNAL];
  for (const toolName of readOnlyDomain) {
    const entry = TOOL_MANIFEST.find((e) => e.name === toolName);
    assertExists(entry, `Domain tool '${toolName}' not in manifest`);
    assertEquals(
      entry!.requires_human_approval,
      false,
      `Read-only domain tool '${toolName}' must have requires_human_approval: false`,
    );
    assertEquals(
      entry!.dynamic_mode_allowed,
      true,
      `Read-only domain tool '${toolName}' must have dynamic_mode_allowed: true`,
    );
  }
});

Deno.test("ToolManifest: IToolManifestEntry type is exported from @exaix/mcp", () => {
  const entry: IToolManifestEntry = TOOL_MANIFEST[0];
  assertExists(entry);
});
