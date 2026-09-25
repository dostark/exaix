/**
 * @module ToolCallCanonicalizerTest
 * @path packages/tool-runtime/tests/tool_call_canonicalizer_test.ts
 * @description Tests for canonicalizeForRegistry: it derives acceptedParams from the
 *   registry's real registered tool schemas, so aliases rename exactly as they would at the
 *   registry, and the alias tables never collide with a parameter a tool declares itself.
 * @architectural-layer Tool Runtime
 * @related-files [packages/tool-runtime/src/tool_call_canonicalizer.ts, packages/core/src/types/tool_aliases.ts, packages/tool-runtime/src/tool_schemas.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { COMMON_PARAM_ALIASES, TOOL_PARAM_ALIASES, ToolName } from "@exaix/core";
import type { ITool } from "@exaix/core/types";
import { canonicalizeForRegistry } from "../src/tool_call_canonicalizer.ts";
import { createCoreToolSchemas } from "../src/tool_schemas.ts";

const CORE_TOOLS: ITool[] = createCoreToolSchemas();
const registry = { getTools: (): ITool[] => CORE_TOOLS };

Deno.test("[tool_call_canonicalizer] canonicalizeForRegistry renames file_path to path for read_file using the registry's schema", () => {
  const result = canonicalizeForRegistry(registry, "Read", { file_path: "src/a.ts" });
  assertEquals(result.name, ToolName.READ_FILE);
  assertEquals(result.params, { path: "src/a.ts" });
  assertEquals(result.renamedParams, [{ from: "file_path", to: "path" }]);
  assertEquals(result.rewritten, true);
});

Deno.test("[tool_call_canonicalizer] a tool without a path parameter keeps file_path unrenamed", () => {
  const result = canonicalizeForRegistry(registry, ToolName.GIT_INFO, { file_path: "x" });
  assertEquals(result.params, { file_path: "x" });
  assertEquals(result.rewritten, false);
});

Deno.test("[tool_call_canonicalizer] glob with query and file_path canonicalizes to search_files pattern and path", () => {
  const result = canonicalizeForRegistry(registry, "glob", { query: "*.ts", file_path: "." });
  assertEquals(result.name, ToolName.SEARCH_FILES);
  assertEquals(result.params, { pattern: "*.ts", path: "." });
});

Deno.test("[tool_call_canonicalizer] an unregistered tool name passes through with only per-tool renames", () => {
  const result = canonicalizeForRegistry(registry, "unknown_tool", { file_path: "x" });
  assertEquals(result.name, "unknown_tool");
  assertEquals(result.params, { file_path: "x" });
});

Deno.test("[tool_call_canonicalizer][parity] no common alias key appears in any registered tool's parameters.properties", () => {
  for (const tool of CORE_TOOLS) {
    for (const alias of Object.keys(COMMON_PARAM_ALIASES)) {
      assert(!Object.hasOwn(tool.parameters.properties, alias), `${tool.name} declares common alias key ${alias}`);
    }
  }
});

Deno.test("[tool_call_canonicalizer][parity] no per-tool alias key is declared by that tool, and every target key is", () => {
  for (const tool of CORE_TOOLS) {
    const perTool = TOOL_PARAM_ALIASES[tool.name];
    if (!perTool) continue;
    for (const [alias, target] of Object.entries(perTool)) {
      assert(!Object.hasOwn(tool.parameters.properties, alias), `${tool.name} declares its own alias key ${alias}`);
      assert(Object.hasOwn(tool.parameters.properties, target), `${tool.name} does not declare target key ${target}`);
    }
  }
});
