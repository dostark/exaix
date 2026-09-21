/**
 * @module ListAvailableToolsToolTest
 * @path packages/tool-runtime/tests/list_available_tools_tool_test.ts
 * @description Verifies the read-only `list_available_tools` discovery tool: it returns the full
 *   catalog of registered tools with each tool's functional description and parameter schema,
 *   so a planning or execution model selects a tool by what it does rather than by guessing from
 *   a bare name. Also verifies it is NONE-scope (never mutates) and takes no arguments.
 * @architectural-layer Test
 * @related-files [packages/tool-runtime/src/tool_registry.ts, packages/tool-runtime/src/tool_schemas.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";
import { type JSONValue, ToolName } from "@exaix/core";

interface ICatalogEntry {
  name: string;
  description: string;
  parameters: { properties: Record<string, { type?: string }> };
}

/** Read the catalog entries out of an IToolResult.data JSONValue, validating the shape
 *  structurally instead of a blanket cast. */
function readCatalog(data: JSONValue): ICatalogEntry[] {
  if (!Array.isArray(data)) throw new Error("list_available_tools must return an array");
  const entries: ICatalogEntry[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("list_available_tools entry must be an object");
    }
    const rec = item as Record<string, JSONValue>;
    const name = typeof rec.name === "string" ? rec.name : "";
    const description = typeof rec.description === "string" ? rec.description : "";
    const parameters = typeof rec.parameters === "object" && rec.parameters !== null
      ? rec.parameters as Record<string, JSONValue>
      : {};
    entries.push({
      name,
      description,
      parameters: { properties: parameters.properties as Record<string, { type?: string }> ?? {} },
    });
  }
  return entries;
}

Deno.test("[list_available_tools] returns the full registered tool catalog with functional descriptions", async () => {
  const registry = new ToolRegistry({ config: createMockConfig(Deno.cwd()) });
  const result = await registry.execute(ToolName.LIST_AVAILABLE_TOOLS, {});

  assertEquals(result.success, true, result.error ?? "expected success");
  const catalog = readCatalog(result.data);
  const names = catalog.map((t) => t.name);
  assert(names.length >= 18, `expected at least the core tool set, got ${names.length}`);

  const readFile = catalog.find((t) => t.name === ToolName.READ_FILE);
  assert(readFile, "catalog must include read_file");
  assert(
    typeof readFile.description === "string" && readFile.description.length > 40,
    "read_file catalog entry must carry a real functional description",
  );
  assert(
    readFile.parameters && typeof readFile.parameters.properties === "object",
    "read_file catalog entry must carry its parameter schema",
  );

  const writeFile = catalog.find((t) => t.name === ToolName.WRITE_FILE);
  assert(writeFile, "catalog must include write_file");
  assert(writeFile.description.length > 40, "write_file must carry a functional description");
});

Deno.test("[list_available_tools] is read-only (NONE scope) and takes no arguments", async () => {
  const registry = new ToolRegistry({ config: createMockConfig(Deno.cwd()) });
  // With no arguments it succeeds; with unexpected args it still succeeds (params are ignored).
  const noArgs = await registry.execute(ToolName.LIST_AVAILABLE_TOOLS, {});
  assertEquals(noArgs.success, true);
  const withArgs = await registry.execute(ToolName.LIST_AVAILABLE_TOOLS, { limit: 5 });
  assertEquals(withArgs.success, true, "unexpected args are tolerated (no required params)");
});
