/**
 * @module ToolDocsParityTest
 * @path tests/mcp/tool_docs_parity_test.ts
 * @description Parity tests verifying that TOOLS.md AGENT_TOOLS table cells (category,
 * dynamic mark, approval mark) match the canonical manifest metadata for each tool.
 * Fails when sync_tool_schemas.ts generates inconsistent output or when TOOLS.md drifts
 * after a manifest change without re-running docs-sync-schemas.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { TOOL_MANIFEST } from "@exaix/mcp";
import { ToolCategory, ToolKind } from "@exaix/core";

const TOOLS_MD_PATH = join(Deno.cwd(), "TOOLS.md");
const AGENT_TOOLS_START = "<!-- AGENT_TOOLS_START -->";
const AGENT_TOOLS_END = "<!-- AGENT_TOOLS_END -->";

async function readAgentToolsSection(): Promise<string> {
  const content = await Deno.readTextFile(TOOLS_MD_PATH);
  const startIdx = content.indexOf(AGENT_TOOLS_START);
  const endIdx = content.indexOf(AGENT_TOOLS_END);
  assert(startIdx !== -1 && endIdx !== -1, "TOOLS.md must contain AGENT_TOOLS markers");
  return content.slice(startIdx + AGENT_TOOLS_START.length, endIdx);
}

const CATEGORY_LABELS: Record<string, string> = {
  [ToolCategory.READ]: "read",
  [ToolCategory.WRITE]: "write",
  [ToolCategory.GIT]: "git",
  [ToolCategory.DOMAIN]: "domain",
  [ToolCategory.NETWORK]: "network",
  [ToolCategory.META]: "meta",
};

// ── Parity tests ──────────────────────────────────────────────────────────────

Deno.test("docs_parity: category labels in TOOLS.md match manifest ToolCategory", async () => {
  const section = await readAgentToolsSection();
  const liveTools = TOOL_MANIFEST.filter(
    (e) => e.docs_visible && (e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN),
  );

  const mismatches: string[] = [];
  for (const tool of liveTools) {
    const expectedLabel = CATEGORY_LABELS[tool.category] ?? tool.category;
    const toolRow = section.split("\n").find((line) => line.includes(`\`${tool.name}\``));
    if (!toolRow) {
      mismatches.push(`${tool.name}: row not found`);
      continue;
    }
    if (!toolRow.includes(`\`${expectedLabel}\``)) {
      mismatches.push(`${tool.name}: expected category '${expectedLabel}' not found in row`);
    }
  }

  assertEquals(
    mismatches,
    [],
    `Category label mismatches in TOOLS.md: [${
      mismatches.join("; ")
    }]. Run 'deno task docs-sync-schemas' to regenerate.`,
  );
});

Deno.test("docs_parity: dynamic marks in TOOLS.md match manifest dynamic_mode_allowed", async () => {
  const section = await readAgentToolsSection();
  const liveTools = TOOL_MANIFEST.filter(
    (e) => e.docs_visible && (e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN),
  );

  const mismatches: string[] = [];
  for (const tool of liveTools) {
    const expectedMark = tool.dynamic_mode_allowed && !tool.requires_human_approval ? "✓" : "—";
    const toolRow = section.split("\n").find((line) => line.includes(`\`${tool.name}\``));
    if (!toolRow) {
      mismatches.push(`${tool.name}: row not found`);
      continue;
    }
    if (!toolRow.includes(expectedMark)) {
      mismatches.push(
        `${tool.name}: expected dynamic mark '${expectedMark}' not found in row`,
      );
    }
  }

  assertEquals(
    mismatches,
    [],
    `Dynamic mark mismatches in TOOLS.md: [${mismatches.join("; ")}]. Run 'deno task docs-sync-schemas' to regenerate.`,
  );
});

Deno.test("docs_parity: approval marks in TOOLS.md match manifest requires_human_approval", async () => {
  const section = await readAgentToolsSection();
  const approvalTools = TOOL_MANIFEST.filter(
    (e) =>
      e.docs_visible &&
      (e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN) &&
      e.requires_human_approval,
  );

  const mismatches: string[] = [];
  for (const tool of approvalTools) {
    const toolRow = section.split("\n").find((line) => line.includes(`\`${tool.name}\``));
    if (!toolRow) {
      mismatches.push(`${tool.name}: row not found`);
      continue;
    }
    if (!toolRow.includes("⚠ Phase 79")) {
      mismatches.push(`${tool.name}: missing '⚠ Phase 79' approval mark`);
    }
  }

  assertEquals(
    mismatches,
    [],
    `Approval mark mismatches in TOOLS.md: [${
      mismatches.join("; ")
    }]. Run 'deno task docs-sync-schemas' to regenerate.`,
  );
});

Deno.test("docs_parity: source links in TOOLS.md match explicit manifest source_ref metadata", async () => {
  const section = await readAgentToolsSection();
  const liveTools = TOOL_MANIFEST.filter(
    (e) => e.docs_visible && (e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN),
  );

  const mismatches: string[] = [];
  for (const tool of liveTools) {
    const toolRow = section.split("\n").find((line) => line.includes(`\`${tool.name}\``));
    if (!toolRow) {
      mismatches.push(`${tool.name}: row not found`);
      continue;
    }

    if (!tool.source_ref) {
      mismatches.push(`${tool.name}: missing manifest source_ref`);
      continue;
    }

    if (!toolRow.includes(`(${tool.source_ref})`)) {
      mismatches.push(`${tool.name}: expected source link '${tool.source_ref}' not found in row`);
    }
  }

  assertEquals(
    mismatches,
    [],
    `Source link mismatches in TOOLS.md: [${mismatches.join("; ")}]. Run 'deno task docs-sync-schemas' to regenerate.`,
  );
});
