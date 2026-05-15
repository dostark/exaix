/**
 * @module ToolClassificationTest
 * @path tests/mcp/tool_classification_test.ts
 * @description Verifies that McpToolName enum contains only live MCP tool names (no dead entries)
 * and that READ_ONLY_TOOLS / WRITE_TOOLS classification is derived from live manifest
 * entries only. Step 77.2 normalization tests.
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { McpToolName, READ_ONLY_TOOLS, TOOL_MANIFEST, ToolKind, WRITE_TOOLS } from "@exaix/mcp";

const liveMcpNames = new Set(
  TOOL_MANIFEST
    .filter((e) => e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN)
    .map((e) => e.name),
);

Deno.test("ToolClassification: McpToolName has no dead FETCH_URL entry", () => {
  assertFalse(
    (Object.values(McpToolName) as string[]).includes("FETCH_URL"),
    'Dead enum entry McpToolName.FETCH_URL = "FETCH_URL" must be removed; ' +
      "fetch_url is internal-only and belongs exclusively in ToolName",
  );
});

Deno.test("ToolClassification: McpToolName has no dead GIT raw entry", () => {
  assertFalse(
    (Object.values(McpToolName) as string[]).includes("git"),
    'Dead enum entry McpToolName.GIT = "git" must be removed; ' +
      "git_* tools use specific suffixed enum values (GIT_STATUS, GIT_COMMIT, etc.)",
  );
});

Deno.test("ToolClassification: READ_ONLY_TOOLS contains only live MCP tool names", () => {
  for (const tool of READ_ONLY_TOOLS) {
    assert(
      liveMcpNames.has(tool),
      `READ_ONLY_TOOLS contains dead or non-MCP entry: "${tool}"`,
    );
  }
});

Deno.test("ToolClassification: WRITE_TOOLS contains only live MCP tool names", () => {
  for (const tool of WRITE_TOOLS) {
    assert(
      liveMcpNames.has(tool),
      `WRITE_TOOLS contains dead or non-MCP entry: "${tool}"`,
    );
  }
});

Deno.test("ToolClassification: every McpToolName value is a live MCP tool", () => {
  for (const value of Object.values(McpToolName)) {
    assert(
      liveMcpNames.has(value),
      `McpToolName has value "${value}" not in live MCP manifest — dead enum entry`,
    );
  }
});

Deno.test("ToolClassification: McpToolName count matches live MCP manifest count", () => {
  assertEquals(
    Object.values(McpToolName).length,
    liveMcpNames.size,
    `McpToolName has ${Object.values(McpToolName).length} entries but manifest has ${liveMcpNames.size} live MCP tools`,
  );
});
