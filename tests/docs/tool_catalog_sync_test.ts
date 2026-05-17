/**
 * @module ToolCatalogSyncTest
 * @path tests/docs/tool_catalog_sync_test.ts
 * @description Verifies that TOOLS.md AGENT_TOOLS section is generated from and matches the
 * canonical tool manifest. Fails when TOOLS.md drifts from the manifest — run
 * `deno task docs-sync-schemas` to fix.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { TOOL_MANIFEST } from "@exaix/mcp";
import { ToolKind } from "@exaix/core";

const TOOLS_MD_PATH = join(Deno.cwd(), "TOOLS.md");
const AGENT_TOOLS_START = "<!-- AGENT_TOOLS_START -->";
const AGENT_TOOLS_END = "<!-- AGENT_TOOLS_END -->";

/** Extract the AGENT_TOOLS section from TOOLS.md */
async function readAgentToolsSection(): Promise<string> {
  const content = await Deno.readTextFile(TOOLS_MD_PATH);
  const startIdx = content.indexOf(AGENT_TOOLS_START);
  const endIdx = content.indexOf(AGENT_TOOLS_END);

  assert(startIdx !== -1, `TOOLS.md must contain ${AGENT_TOOLS_START}`);
  assert(endIdx !== -1, `TOOLS.md must contain ${AGENT_TOOLS_END}`);
  assert(startIdx < endIdx, "AGENT_TOOLS_START must precede AGENT_TOOLS_END");

  return content.slice(startIdx + AGENT_TOOLS_START.length, endIdx);
}

/** Collect all canonical docs-visible MCP tool names from the manifest */
function getExpectedToolNames(): string[] {
  return TOOL_MANIFEST
    .filter((e) => e.docs_visible && (e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN))
    .map((e) => e.name)
    .sort();
}

// ── Structural tests ──────────────────────────────────────────────────────────

Deno.test("tool_catalog_sync: TOOLS.md contains AGENT_TOOLS markers", async () => {
  const content = await Deno.readTextFile(TOOLS_MD_PATH);
  assert(content.includes(AGENT_TOOLS_START), "Missing AGENT_TOOLS_START marker");
  assert(content.includes(AGENT_TOOLS_END), "Missing AGENT_TOOLS_END marker");
});

Deno.test("tool_catalog_sync: TOOLS.md AGENT_TOOLS section is not empty", async () => {
  const section = await readAgentToolsSection();
  assert(section.trim().length > 0, "AGENT_TOOLS section must not be empty");
  assert(section.includes("|"), "AGENT_TOOLS section must contain a table (| delimited)");
});

Deno.test("tool_catalog_sync: TOOLS.md describes Source column as a current ownership hint", async () => {
  const content = await Deno.readTextFile(TOOLS_MD_PATH);
  assert(
    content.includes("Source column is generated from explicit manifest ownership metadata"),
    "TOOLS.md must describe the Source column as coming from explicit manifest ownership metadata",
  );
  assert(
    !content.includes("remain correct regardless of file layout"),
    "TOOLS.md must not claim the catalog remains correct regardless of file layout",
  );
});

// ── Completeness tests ────────────────────────────────────────────────────────

Deno.test("tool_catalog_sync: all manifest docs-visible tools appear in TOOLS.md", async () => {
  const section = await readAgentToolsSection();
  const expectedTools = getExpectedToolNames();

  assertExists(expectedTools.length, "manifest must have docs-visible MCP tools");
  assert(expectedTools.length > 0, "manifest must have at least one docs-visible MCP tool");

  const missing: string[] = [];
  for (const toolName of expectedTools) {
    if (!section.includes(`\`${toolName}\``)) {
      missing.push(toolName);
    }
  }

  assertEquals(
    missing,
    [],
    `The following tools are in the manifest but missing from TOOLS.md: [${missing.join(", ")}]. ` +
      `Run 'deno task docs-sync-schemas' to regenerate.`,
  );
});

Deno.test("tool_catalog_sync: domain tools appear in TOOLS.md AGENT_TOOLS section", async () => {
  const section = await readAgentToolsSection();
  const domainTools = TOOL_MANIFEST
    .filter((e) => e.docs_visible && e.kind === ToolKind.MCP_DOMAIN)
    .map((e) => e.name);

  assert(domainTools.length > 0, "manifest must contain docs-visible domain tools");

  for (const toolName of domainTools) {
    assert(
      section.includes(`\`${toolName}\``),
      `Domain tool '${toolName}' is missing from TOOLS.md AGENT_TOOLS section`,
    );
  }
});

Deno.test("tool_catalog_sync: internal-only tools do NOT appear in TOOLS.md AGENT_TOOLS section", async () => {
  const section = await readAgentToolsSection();
  const internalTools = TOOL_MANIFEST
    .filter((e) => e.kind === ToolKind.INTERNAL_ONLY)
    .map((e) => e.name);

  for (const toolName of internalTools) {
    assert(
      !section.includes(`\`${toolName}\``),
      `Internal-only tool '${toolName}' must NOT appear in the public TOOLS.md catalog`,
    );
  }
});

Deno.test("tool_catalog_sync: tool count in TOOLS.md matches manifest docs-visible count", async () => {
  const section = await readAgentToolsSection();
  const expectedTools = getExpectedToolNames();

  // Count backtick-wrapped tool names in the section (table rows)
  const tableEntries = section.match(/`[a-z_]+`/g) ?? [];
  // Filter to only actual tool name entries (they contain underscores or start with exaix_)
  const toolEntries = tableEntries.filter((t) => expectedTools.includes(t.replace(/`/g, "")));

  assertEquals(
    toolEntries.length,
    expectedTools.length,
    `Expected ${expectedTools.length} tools in TOOLS.md, found ${toolEntries.length}. ` +
      `Expected: [${expectedTools.join(", ")}]`,
  );
});
