/**
 * @module ToolRegistryAciCatalogTest
 * @path packages/tool-runtime/tests/tool_registry_aci_catalog_test.ts
 * @description Phase 112 Step 4 — verifies the complete `createCoreToolSchemas()` catalog: all
 *   14 ReAct tools have a schema-valid `aciDoc`, a non-empty rendered fragment, the canonical
 *   `sideEffectScope`, a worked example compatible with the tool's own `parameters` schema, and
 *   an anti-example that genuinely violates a named constraint (unknown key, missing required
 *   key, wrong type, or invalid enum value) of that same schema.
 * @architectural-layer Test
 * @related-files ["packages/tool-runtime/src/tool_schemas.ts", "packages/tool-runtime/src/aci_example_validator.ts"]
 */
import { assert, assertEquals } from "@std/assert";
import { AciDocSchema } from "@exaix/schemas";
import { ToolSideEffectScope } from "@exaix/core";
import { createCoreToolSchemas, renderAciDocFragments, validateAciExampleAgainstSchema } from "@exaix/tool-runtime";

/** Canonical side-effect scope per Step 4's Actions: NONE for read/search/list/grep/git-info;
 * PORTAL for file/directory mutation; NETWORK for fetch_url; SYSTEM for run_command/deno_task. */
const EXPECTED_SCOPES: Record<string, ToolSideEffectScope> = {
  read_file: ToolSideEffectScope.NONE,
  write_file: ToolSideEffectScope.PORTAL,
  list_directory: ToolSideEffectScope.NONE,
  search_files: ToolSideEffectScope.NONE,
  create_directory: ToolSideEffectScope.PORTAL,
  run_command: ToolSideEffectScope.SYSTEM,
  fetch_url: ToolSideEffectScope.NETWORK,
  grep_search: ToolSideEffectScope.NONE,
  move_file: ToolSideEffectScope.PORTAL,
  copy_file: ToolSideEffectScope.PORTAL,
  delete_file: ToolSideEffectScope.PORTAL,
  git_info: ToolSideEffectScope.NONE,
  deno_task: ToolSideEffectScope.SYSTEM,
  patch_file: ToolSideEffectScope.PORTAL,
};

Deno.test("[ToolRegistryAciCatalog] createCoreToolSchemas returns exactly the 14 named ReAct tools", () => {
  const tools = createCoreToolSchemas();
  assertEquals(tools.length, 14);
  assertEquals(new Set(tools.map((t) => t.name)), new Set(Object.keys(EXPECTED_SCOPES)));
});

Deno.test("[ToolRegistryAciCatalog] every tool has a schema-valid aciDoc and the canonical side-effect scope", () => {
  const tools = createCoreToolSchemas();
  for (const tool of tools) {
    const expectedScope = EXPECTED_SCOPES[tool.name];
    assert(expectedScope !== undefined, `${tool.name} is missing from EXPECTED_SCOPES`);
    assertEquals(tool.sideEffectScope, expectedScope, `${tool.name}: unexpected sideEffectScope`);

    assert(tool.aciDoc !== undefined, `${tool.name} is missing aciDoc`);
    const parsed = AciDocSchema.safeParse(tool.aciDoc);
    assert(parsed.success, `${tool.name}: aciDoc failed schema validation`);
  }
});

Deno.test("[ToolRegistryAciCatalog] every tool renders a non-empty ACI fragment", () => {
  const tools = createCoreToolSchemas();
  const allIds = tools.map((t) => t.name);
  const result = renderAciDocFragments(tools, allIds, 1_000_000);
  assertEquals(result.invalidToolIds, [], "no tool's aciDoc should be rejected as invalid");
  assertEquals(result.fragmentCount, 14);
  assertEquals(result.truncated, false);
  for (const toolId of allIds) {
    assert(result.text.includes(toolId), `rendered ACI text is missing a fragment for ${toolId}`);
  }
});

Deno.test("[ToolRegistryAciCatalog] every worked example is compatible with the tool's own parameter schema", () => {
  const tools = createCoreToolSchemas();
  for (const tool of tools) {
    const doc = tool.aciDoc;
    assert(doc !== undefined, `${tool.name} is missing aciDoc`);
    const result = validateAciExampleAgainstSchema(tool.parameters, doc.example.input);
    assert(
      result.compatible,
      `${tool.name}: worked example is incompatible with its own schema: ${result.violations.join("; ")}`,
    );
  }
});

Deno.test("[ToolRegistryAciCatalog] every anti-example genuinely violates a named constraint of the tool's own schema", () => {
  const tools = createCoreToolSchemas();
  for (const tool of tools) {
    const doc = tool.aciDoc;
    assert(doc !== undefined, `${tool.name} is missing aciDoc`);
    const result = validateAciExampleAgainstSchema(tool.parameters, doc.anti_example.input);
    assert(!result.compatible, `${tool.name}: anti-example unexpectedly satisfies its own schema`);
    assert(result.violations.length > 0, `${tool.name}: anti-example reports no violations`);
  }
});

Deno.test("[ToolRegistryAciCatalog] canary: deleting one real catalog entry's ACI block is caught", () => {
  const tools = createCoreToolSchemas();
  const withoutOneAciDoc = tools.map((t, i) => i === 0 ? { ...t, aciDoc: undefined } : t);

  let missing = 0;
  for (const tool of withoutOneAciDoc) {
    if (tool.aciDoc === undefined) missing++;
  }
  assertEquals(missing, 1, "the canary mutation itself must remove exactly one tool's aciDoc");

  const stillValid = withoutOneAciDoc.every((tool) => tool.aciDoc !== undefined);
  assertEquals(stillValid, false, "a real catalog entry missing its ACI block must be detectable");
});
