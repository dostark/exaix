/**
 * @module ToolRegistryCoreSchemasTest
 * @path packages/tool-runtime/tests/tool_registry_core_schemas_test.ts
 * @description Pins the exact set and shape of core tool schemas registered by
 * ToolRegistry. Guards the registerCoreTools -> CORE_TOOL_SCHEMAS extraction
 * (god-object decomposition) against accidental drops, duplicates, or content
 * drift when the schema data is moved to its own module.
 */

import { assertEquals } from "@std/assert";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";

const EXPECTED_CORE_TOOL_NAMES = [
  "read_file",
  "write_file",
  "list_directory",
  "search_files",
  "create_directory",
  "run_command",
  "fetch_url",
  "grep_search",
  "move_file",
  "copy_file",
  "delete_file",
  "git_info",
  "deno_task",
  "patch_file",
].sort();

function registryTools() {
  const config = createMockConfig("/tmp/core-schemas-test");
  const registry = new ToolRegistry({ config });
  return registry.getTools();
}

Deno.test("tool_registry_core_schemas: registers exactly the expected core tool names, no duplicates", () => {
  const names = registryTools().map((t) => t.name).sort();
  assertEquals(names, EXPECTED_CORE_TOOL_NAMES);
});

Deno.test("tool_registry_core_schemas: every tool has a well-formed object schema", () => {
  for (const tool of registryTools()) {
    assertEquals(tool.parameters.type, "object");
    assertEquals(typeof tool.parameters.properties, "object");
  }
});

Deno.test("tool_registry_core_schemas: read_file schema matches known contract", () => {
  const readFile = registryTools().find((t) => t.name === "read_file");
  assertEquals(readFile?.parameters.required, ["path"]);
  assertEquals(Object.keys(readFile?.parameters.properties ?? {}), ["path"]);
});

Deno.test("tool_registry_core_schemas: patch_file schema matches known contract", () => {
  const patchFile = registryTools().find((t) => t.name === "patch_file");
  assertEquals(patchFile?.parameters.required, ["path", "search", "replace"]);
});

Deno.test("tool_registry_core_schemas: move_file schema matches known contract", () => {
  const moveFile = registryTools().find((t) => t.name === "move_file");
  assertEquals(moveFile?.parameters.required, ["from", "to"]);
});

Deno.test("tool_registry_core_schemas: list_directory schema matches known contract (path optional)", () => {
  const listDirectory = registryTools().find((t) => t.name === "list_directory");
  assertEquals(listDirectory?.parameters.required, []);
});

Deno.test("tool_registry_core_schemas: search_files schema matches known contract (path optional)", () => {
  const searchFiles = registryTools().find((t) => t.name === "search_files");
  assertEquals(searchFiles?.parameters.required, ["pattern"]);
});
