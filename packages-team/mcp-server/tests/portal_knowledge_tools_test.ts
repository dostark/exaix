/**
 * @module PortalKnowledgeToolsTest
 * @path packages-team/mcp-server/tests/portal_knowledge_tools_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Unit tests for the PortalSymbolsTool MCP tool (exaix_portal_symbols).
 */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { PortalSymbolsTool } from "../portal_knowledge_tools.ts";
import {
  assertToolDefinitionFields,
  createBaseToolContext,
  createPermissionsService,
  createToolContext,
  getFirstStructuredDataContent,
  getFirstTextContent,
  withToolPermissionTest,
} from "@exaix/mcp/testing";
import { McpToolName } from "@exaix/mcp";
import type { ISymbolEntry } from "@exaix/schemas";

/** Four symbols spanning every filterable dimension: kind, name, and rank. */
const SAMPLE_SYMBOLS: ISymbolEntry[] = [
  {
    name: "greet",
    kind: "function",
    file: "src/main.ts",
    signature: "function greet(name: string): string",
    doc: "Greets a user by name.",
    pageRankScore: 5,
  },
  { name: "Greeter", kind: "class", file: "src/main.ts", signature: "class Greeter", pageRankScore: 3 },
  {
    name: "HelperOptions",
    kind: "interface",
    file: "src/helper.ts",
    signature: "interface HelperOptions",
    pageRankScore: 1,
  },
  {
    name: "MAX_RETRIES",
    kind: "const",
    file: "src/main.ts",
    signature: "const MAX_RETRIES: number",
    pageRankScore: 0.5,
  },
];

async function writeKnowledgeFixture(
  tempDir: string,
  portalAlias: string,
  symbolMap: ISymbolEntry[] = SAMPLE_SYMBOLS,
): Promise<void> {
  const dir = join(tempDir, "Memory", "Projects", portalAlias);
  await ensureDir(dir);
  await Deno.writeTextFile(
    join(dir, "knowledge.json"),
    JSON.stringify({
      portal: portalAlias,
      gatheredAt: new Date().toISOString(),
      version: 1,
      architectureOverview: "A tiny fixture portal used to test the portal symbols MCP tool.",
      layers: [],
      keyFiles: [],
      conventions: [],
      dependencies: [],
      techStack: { primaryLanguage: "typescript" },
      symbolMap,
      stats: { totalFiles: 3, totalDirectories: 2, extensionDistribution: { ".ts": 3 } },
      metadata: { durationMs: 5, mode: "standard", filesScanned: 3, filesRead: 3 },
    }),
  );
}

function createHandler(env: Parameters<typeof createToolContext>[0]): PortalSymbolsTool {
  return new PortalSymbolsTool(createToolContext(env), createPermissionsService(env));
}

Deno.test("PortalSymbolsTool: returns symbols ranked by pageRankScore descending", async () => {
  await withToolPermissionTest({ portalAlias: "symbols-portal" }, async (env) => {
    await writeKnowledgeFixture(env.tempDir, "symbols-portal");
    const handler = createHandler(env);

    const response = await handler.execute({ portal: "symbols-portal", agent_role: "test-agent" });

    assertEquals(response.isError, undefined);
    const data = getFirstStructuredDataContent<ISymbolEntry[]>(response);
    assertEquals(data.map((s) => s.name), ["greet", "Greeter", "HelperOptions", "MAX_RETRIES"]);
  });
});

Deno.test("PortalSymbolsTool: filters by case-insensitive name substring", async () => {
  await withToolPermissionTest({ portalAlias: "symbols-portal" }, async (env) => {
    await writeKnowledgeFixture(env.tempDir, "symbols-portal");
    const handler = createHandler(env);

    const response = await handler.execute({ portal: "symbols-portal", agent_role: "test-agent", query: "helper" });

    const data = getFirstStructuredDataContent<ISymbolEntry[]>(response);
    assertEquals(data.map((s) => s.name), ["HelperOptions"]);
  });
});

Deno.test("PortalSymbolsTool: filters by symbol kind", async () => {
  await withToolPermissionTest({ portalAlias: "symbols-portal" }, async (env) => {
    await writeKnowledgeFixture(env.tempDir, "symbols-portal");
    const handler = createHandler(env);

    const response = await handler.execute({ portal: "symbols-portal", agent_role: "test-agent", kind: "const" });

    const data = getFirstStructuredDataContent<ISymbolEntry[]>(response);
    assertEquals(data.map((s) => s.name), ["MAX_RETRIES"]);
  });
});

Deno.test("PortalSymbolsTool: limit caps the result count after ranking", async () => {
  await withToolPermissionTest({ portalAlias: "symbols-portal" }, async (env) => {
    await writeKnowledgeFixture(env.tempDir, "symbols-portal");
    const handler = createHandler(env);

    const response = await handler.execute({ portal: "symbols-portal", agent_role: "test-agent", limit: 2 });

    const data = getFirstStructuredDataContent<ISymbolEntry[]>(response);
    assertEquals(data.map((s) => s.name), ["greet", "Greeter"]);
  });
});

Deno.test("PortalSymbolsTool: portal not yet analyzed returns isError:true, not thrown", async () => {
  await withToolPermissionTest({ portalAlias: "unanalyzed-portal" }, async (env) => {
    const handler = createHandler(env);

    const response = await handler.execute({ portal: "unanalyzed-portal", agent_role: "test-agent" });

    assertEquals(response.isError, true);
    assertEquals(getFirstTextContent(response).includes("has not been analyzed"), true);
  });
});

Deno.test("PortalSymbolsTool: unknown portal returns isError:true, not thrown", async () => {
  await withToolPermissionTest({ portalAlias: "symbols-portal" }, async (env) => {
    const handler = createHandler(env);

    const response = await handler.execute({ portal: "does-not-exist", agent_role: "test-agent" });

    assertEquals(response.isError, true);
    assertEquals(getFirstTextContent(response).includes("Portal 'does-not-exist' not found"), true);
  });
});

Deno.test("PortalSymbolsTool: identity without portal permission is denied", async () => {
  await withToolPermissionTest({ portalAlias: "symbols-portal", identityId: "allowed-agent" }, async (env) => {
    await writeKnowledgeFixture(env.tempDir, "symbols-portal");
    const handler = createHandler(env);

    const response = await handler.execute({ portal: "symbols-portal", agent_role: "other-agent" });

    assertEquals(response.isError, true);
    assertEquals(getFirstTextContent(response).includes("not allowed to access portal 'symbols-portal'"), true);
  });
});

Deno.test("PortalSymbolsTool: getToolDefinition returns correct definition", () => {
  const handler = new PortalSymbolsTool(createBaseToolContext());
  assertToolDefinitionFields(handler.getToolDefinition(), McpToolName.PORTAL_SYMBOLS, ["portal", "agent_role"]);
});
