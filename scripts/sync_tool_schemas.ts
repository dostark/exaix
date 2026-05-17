#!/usr/bin/env -S deno run -A
/**
 * @module SyncToolSchemas
 * @path scripts/sync_tool_schemas.ts
 * @description Generates the AGENT_TOOLS section in TOOLS.md from the canonical tool manifest
 * in @exaix/mcp. All docs-visible MCP handler and domain tools are included automatically —
 * no filesystem scanning required. Run via `deno task docs-sync-schemas`.
 *
 * Usage: deno task docs-sync-schemas
 *
 * Canonical source: packages/mcp/src/manifest.ts:TOOL_MANIFEST
 * Output target:    TOOLS.md (<!-- AGENT_TOOLS_START --> ... <!-- AGENT_TOOLS_END -->)
 *
 * Migration note (Phase 76/77): The manifest lives in packages/mcp/ (package-owned). This
 * script imports explicit source ownership references from @exaix/mcp, so the catalog does
 * not infer file paths from naming conventions. Update manifest source_ref values when
 * concrete handlers move during package extraction.
 */

import { join } from "@std/path";
import { TOOL_MANIFEST } from "@exaix/mcp";
import { ToolCategory, ToolKind } from "@exaix/core";

const TOOLS_MD = "TOOLS.md";
const SYNC_START = "<!-- AGENT_TOOLS_START -->";
const SYNC_END = "<!-- AGENT_TOOLS_END -->";

/** Format category label for display. */
function categoryLabel(cat: ToolCategory): string {
  const labels: Record<string, string> = {
    [ToolCategory.READ]: "read",
    [ToolCategory.WRITE]: "write",
    [ToolCategory.GIT]: "git",
    [ToolCategory.DOMAIN]: "domain",
    [ToolCategory.NETWORK]: "network",
    [ToolCategory.META]: "meta",
  };
  return labels[cat] ?? cat;
}

async function main() {
  const cwd = Deno.cwd();
  const toolsMdPath = join(cwd, TOOLS_MD);

  // Collect all docs-visible MCP tools from the manifest (source of truth)
  const docsVisibleTools = TOOL_MANIFEST.filter(
    (e) => e.docs_visible && (e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN),
  ).sort((a, b) => a.name.localeCompare(b.name));

  console.log(
    `Syncing ${docsVisibleTools.length} tools from canonical manifest to ${TOOLS_MD}...`,
  );
  console.log(
    `  Handlers: ${docsVisibleTools.filter((e) => e.kind === ToolKind.MCP_HANDLER).length}`,
  );
  console.log(
    `  Domain:   ${docsVisibleTools.filter((e) => e.kind === ToolKind.MCP_DOMAIN).length}`,
  );

  // Build table rows
  let tableRows = "";
  for (const tool of docsVisibleTools) {
    const sourcePath = tool.source_ref;
    if (!sourcePath) {
      throw new Error(`Docs-visible tool '${tool.name}' is missing source_ref in TOOL_MANIFEST`);
    }
    const cat = categoryLabel(tool.category);
    const dynamicMark = tool.dynamic_mode_allowed && !tool.requires_human_approval ? "✓" : "—";
    const approvalMark = tool.requires_human_approval ? "⚠ Phase 79" : "";
    tableRows +=
      `| \`${tool.name}\` | ${tool.description} | \`${cat}\` | ${dynamicMark} | ${approvalMark} | [\`${sourcePath}\`](${sourcePath}) |\n`;
  }

  const agentSection = `## 🤖 Agent Tool Index (MCP) {#agent-tools}

These tools are available to AI agents via the MCP protocol. They are validated, permission-checked,
and logged. The table is generated from the canonical tool manifest in \`packages/mcp/src/manifest.ts\`.
Run \`deno task docs-sync-schemas\` to regenerate after manifest changes.

> **Migration note**: The Source column is generated from explicit manifest ownership metadata.
> It is a current ownership hint, not a promise that the file path is permanent across package migration.
> Update manifest \`source_ref\` values when handlers move; root \`tests/\` retains integration and
> server-wiring coverage while package-owned tests migrate with their implementations.

| Tool | Description | Category | Dynamic | Approval | Source |
|------|-------------|----------|---------|----------|--------|
${tableRows}`;

  const newSection = `${SYNC_START}\n${agentSection}${SYNC_END}`;

  let toolsMdContent = await Deno.readTextFile(toolsMdPath);

  if (toolsMdContent.includes(SYNC_START)) {
    const parts = toolsMdContent.split(SYNC_START);
    const before = parts[0];
    const after = parts[1].split(SYNC_END)[1] ?? "";
    toolsMdContent = before.trimEnd() + "\n\n" + newSection + "\n\n" + after.trimStart();
  } else {
    const footerMarker = "**Footer — Agent Knowledge Base**";
    if (toolsMdContent.includes(footerMarker)) {
      const parts = toolsMdContent.split(footerMarker);
      toolsMdContent = parts[0].trimEnd() + "\n\n" + newSection + "\n\n" + footerMarker + parts[1];
    } else {
      toolsMdContent = toolsMdContent.trimEnd() + "\n\n" + newSection + "\n";
    }
  }

  // Remove any double horizontal rules left from previous runs
  toolsMdContent = toolsMdContent.replace(/---\n---/g, "---");

  await Deno.writeTextFile(toolsMdPath, toolsMdContent);
  console.log(`✅ Successfully synced ${docsVisibleTools.length} tools to ${TOOLS_MD}.`);
  console.log(`   Tools: ${docsVisibleTools.map((t) => t.name).join(", ")}`);
}

if (import.meta.main) {
  main();
}
