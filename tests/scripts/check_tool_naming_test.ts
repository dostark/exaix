/**
 * @module CheckToolNamingTest
 * @path tests/scripts/check_tool_naming_test.ts
 * @description Tests for scripts/check_tool_naming.ts's three pure checker functions and
 *   their behavior against the real ToolName/McpToolName/TOOL_ALIASES/NATIVE_TOOL_NAMES
 *   data (Phase 201 Step 4).
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/core, @exaix/tool-runtime, @exaix/mcp]
 * @related-files [scripts/check_tool_naming.ts, packages/core/src/types/enums.ts, packages/core/src/types/tool_aliases.ts]
 */

import { assertEquals } from "@std/assert";
import {
  findAliasViolations,
  findCatalogViolations,
  findExportAliasViolations,
  findMcpOnlyViolations,
  findNamingViolations,
  findSharedOperationViolations,
} from "../../scripts/check_tool_naming.ts";
import {
  EXECUTION_TOOL_NAMES,
  MCP_ONLY_TOOL_NAMES,
  McpToolName,
  NATIVE_TOOL_NAMES,
  SHARED_TOOL_OPERATIONS,
  TOOL_ALIASES,
  TOOL_NAME_VERBS,
  ToolName,
} from "@exaix/core";
import { createCoreToolSchemas } from "@exaix/tool-runtime";
import { TOOL_MANIFEST } from "@exaix/mcp/manifest.ts";

Deno.test("[naming] check:tool-naming passes on the current enums", () => {
  assertEquals(findNamingViolations(ToolName, TOOL_NAME_VERBS), []);
});

Deno.test("[naming] check:tool-naming fails on a name that violates the convention", () => {
  const errors = findNamingViolations({ BAD: "GrepSearch" }, TOOL_NAME_VERBS);
  assertEquals(errors.length, 1);
  const verbErrors = findNamingViolations({ BAD: "unlisted_verb_tool" }, TOOL_NAME_VERBS);
  assertEquals(verbErrors.length, 1);
});

Deno.test("[naming] excluded native catalog names fail even when they follow the naming convention", () => {
  assertEquals(findNamingViolations({ BAD: "list_symbols" }, TOOL_NAME_VERBS).length, 1);
});

Deno.test("[naming] check:tool-naming fails when an alias shadows a canonical name", () => {
  const canonicalNames = new Set<string>([...Object.values(ToolName), ...Object.values(McpToolName)]);
  const errors = findAliasViolations(
    { [ToolName.READ_FILE]: { canonical: ToolName.WRITE_FILE } },
    canonicalNames,
    NATIVE_TOOL_NAMES,
  );
  assertEquals(errors.length, 1);
});

Deno.test("[naming] an alias targeting NATIVE_TOOL_NAMES fails; general-purpose glob/grep/webfetch mappings pass", () => {
  const canonicalNames = new Set<string>([...Object.values(ToolName), ...Object.values(McpToolName)]);
  for (
    const [alias, canonical] of [
      ["list_symbols", ToolName.QUERY_SYMBOLS],
      ["dependents", ToolName.WHO_DEPENDS_ON],
      ["who_depends_on", ToolName.WHO_DEPENDS_ON],
      ["deno_task", ToolName.DENO_TASK],
    ]
  ) {
    const nativeAliasErrors = findAliasViolations({ [alias]: { canonical } }, canonicalNames, NATIVE_TOOL_NAMES);
    assertEquals(nativeAliasErrors.length, 1);
  }

  assertEquals(findAliasViolations(TOOL_ALIASES, canonicalNames, NATIVE_TOOL_NAMES), []);
});

Deno.test("[naming] every real TOOL_ALIASES entry passes findAliasViolations", () => {
  const canonicalNames = new Set<string>([...Object.values(ToolName), ...Object.values(McpToolName)]);
  assertEquals(findAliasViolations(TOOL_ALIASES, canonicalNames, NATIVE_TOOL_NAMES), []);
});

Deno.test("[naming] every McpToolName value is a ToolName value, exaix_-prefixed, or MCP-only", () => {
  const toolNameValues = new Set<string>(Object.values(ToolName));
  const mcpOnlyNames = new Set<string>(MCP_ONLY_TOOL_NAMES);
  assertEquals(findMcpOnlyViolations(Object.values(McpToolName), toolNameValues, mcpOnlyNames), []);
});

Deno.test("[naming] findMcpOnlyViolations flags an McpToolName value with no ToolName/exaix_/exception match", () => {
  const toolNameValues = new Set<string>(Object.values(ToolName));
  const mcpOnlyNames = new Set<string>(MCP_ONLY_TOOL_NAMES);
  const errors = findMcpOnlyViolations(["unrecognized_mcp_tool"], toolNameValues, mcpOnlyNames);
  assertEquals(errors.length, 1);
});

Deno.test("[parity] every createCoreToolSchemas name and every EXECUTION_TOOL_NAMES entry is a ToolName value", () => {
  const toolNameValues = new Set<string>(Object.values(ToolName));
  for (const tool of createCoreToolSchemas()) {
    assertEquals(toolNameValues.has(tool.name), true, `${tool.name} is not a ToolName value`);
  }
  for (const name of EXECUTION_TOOL_NAMES) {
    assertEquals(toolNameValues.has(name), true, `${name} is not a ToolName value`);
  }
});

Deno.test("[parity] every non-exaix_ TOOL_MANIFEST name is a ToolName value or a declared MCP_ONLY_TOOL_NAMES exception", () => {
  const toolNameValues = new Set<string>(Object.values(ToolName));
  const mcpOnlyNames = new Set<string>(MCP_ONLY_TOOL_NAMES);
  for (const entry of TOOL_MANIFEST) {
    if (entry.name.startsWith("exaix_")) continue;
    const isKnown = toolNameValues.has(entry.name) || mcpOnlyNames.has(entry.name);
    assertEquals(
      isKnown,
      true,
      `${entry.name} is neither a ToolName value nor a declared MCP_ONLY_TOOL_NAMES exception`,
    );
  }
});

Deno.test("[naming] a catalog exposing a retired native name or an unknown name fails; the real catalogs pass", () => {
  const toolNameValues = new Set<string>(Object.values(ToolName));
  const mcpOnlyNames = new Set<string>(MCP_ONLY_TOOL_NAMES);
  for (const retired of ["deno_task", "who_depends_on", "dependents", "list_symbols", " RUN_DENO_TASK "]) {
    assertEquals(findCatalogViolations("fixture", [retired], toolNameValues, mcpOnlyNames).length, 1, retired);
  }
  assertEquals(findCatalogViolations("fixture", ["grep_search"], toolNameValues, mcpOnlyNames).length, 1);
  const registryNames = createCoreToolSchemas().map((tool) => tool.name);
  const manifestNames = TOOL_MANIFEST.map((entry) => entry.name);
  assertEquals(findCatalogViolations("createCoreToolSchemas", registryNames, toolNameValues, mcpOnlyNames), []);
  assertEquals(findCatalogViolations("TOOL_MANIFEST", manifestNames, toolNameValues, mcpOnlyNames), []);
});

Deno.test("[naming] every row of SHARED_TOOL_OPERATIONS resolves to the same string in ToolName and McpToolName", () => {
  assertEquals(SHARED_TOOL_OPERATIONS.length, 12);
  assertEquals(findSharedOperationViolations(SHARED_TOOL_OPERATIONS, ToolName, McpToolName), []);
});

Deno.test("[naming] a deliberately mismatched shared-operation name fails the check", () => {
  const mcpRenamed = { ...McpToolName, READ_FILE: "read_text" };
  const errors = findSharedOperationViolations(SHARED_TOOL_OPERATIONS, ToolName, mcpRenamed);
  assertEquals(errors.some((e) => e.includes("read_file")), true);
});

Deno.test("[naming] a tool present in both enums but missing from SHARED_TOOL_OPERATIONS fails the check", () => {
  const withoutRead = SHARED_TOOL_OPERATIONS.filter((row) => row.canonical !== ToolName.READ_FILE);
  const errors = findSharedOperationViolations(withoutRead, ToolName, McpToolName);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].includes("read_file"), true);
});

Deno.test("[naming] an McpToolName value that is an alias key fails the check (exports stay canonical)", () => {
  assertEquals(findExportAliasViolations(Object.values(McpToolName), TOOL_ALIASES), []);
  assertEquals(findExportAliasViolations([...Object.values(McpToolName), "glob"], TOOL_ALIASES).length, 1);
});
