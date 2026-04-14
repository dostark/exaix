#!/usr/bin/env -S deno run -A
/**
 * @module SyncToolSchemas
 * @path scripts/sync_tool_schemas.ts
 * @description Extracts MCP tool definitions from source and updates TOOLS.md.
 *
 * Usage:
 *   deno run -A scripts/sync_tool_schemas.ts
 */

import { walk } from "@std/fs";
import { basename, join } from "@std/path";

const HANDLERS_DIR = "src/mcp/handlers";
const TOOLS_MD = "TOOLS.md";

async function main() {
  const cwd = Deno.cwd();
  const handlersPath = join(cwd, HANDLERS_DIR);
  const toolsMdPath = join(cwd, TOOLS_MD);

  interface IToolInfo {
    name: string;
    description: string;
    handler: string;
  }
  const tools: IToolInfo[] = [];

  console.log(`Syncing tool schemas from ${HANDLERS_DIR} to ${TOOLS_MD}...`);

  for await (const entry of walk(handlersPath, { includeDirs: false, exts: [".ts"] })) {
    const content = await Deno.readTextFile(entry.path);

    let name: string | null = null;
    const nameMatch = content.match(/name:\s*(?:"([^"]+)"|McpToolName\.([A-Z_]+))/);
    if (nameMatch) {
      name = nameMatch[1] || nameMatch[2].toLowerCase();
    }

    const descMatch = content.match(/description:\s*"([^"]+)"/);

    if (name && descMatch) {
      tools.push({
        name,
        description: descMatch[1],
        handler: join(HANDLERS_DIR, basename(entry.path)),
      });
    }
  }

  // Sort tools by name
  tools.sort((a, b) => a.name.localeCompare(b.name));

  let toolsMdContent = await Deno.readTextFile(toolsMdPath);

  const syncStart = "<!-- AGENT_TOOLS_START -->";
  const syncEnd = "<!-- AGENT_TOOLS_END -->";

  let agentSection = `## 🤖 Agent Tool Index (MCP) {#agent-tools}

These tools are available to AI agents via the MCP protocol. They are validated, permission-checked, and logged.

| Tool | Description | Handler |
|------|-------------|---------|
`;

  for (const tool of tools) {
    agentSection += `| \`${tool.name}\` | ${tool.description} | [\`${tool.handler}\`](${tool.handler}) |\n`;
  }

  const newSection = `${syncStart}\n${agentSection}${syncEnd}`;

  if (toolsMdContent.includes(syncStart)) {
    const parts = toolsMdContent.split(syncStart);
    const before = parts[0];
    const after = parts[1].split(syncEnd)[1] || "";
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

  // Clean up any double "---" that might have been created by previous messy runs
  toolsMdContent = toolsMdContent.replace(/---\n---/g, "---");

  await Deno.writeTextFile(toolsMdPath, toolsMdContent);
  console.log(`Successfully synced ${tools.length} tools to ${TOOLS_MD}.`);
}

if (import.meta.main) {
  main();
}
