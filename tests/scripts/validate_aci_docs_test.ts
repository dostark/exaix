/**
 * @module ValidateAciDocsTest
 * @path tests/scripts/validate_aci_docs_test.ts
 * @description Phase 112 Step 5 — tests for scripts/validate_aci_docs.ts, the dedicated ACI
 *   authoring validator over `createCoreToolSchemas()`. Exercises the pure `validateAciDocs`
 *   checker and the pure `runCli` exit-code wrapper directly (no subprocess spawn, no Git or
 *   network access), matching the plan's determinism requirement. Covers: a compliant
 *   catalog; default-mode warnings; strict-mode errors and exit 2; a catalog/internal-error
 *   exit 1; added, renamed, missing, and invalid tools; the "no removed-tool tracking, no
 *   MCP-visibility special-casing" design properties; and stable, tool-ID-sorted ordering.
 * @architectural-layer Script (test)
 * @dependencies [@std/assert, @exaix/tool-runtime, @exaix/core]
 * @related-files [scripts/validate_aci_docs.ts, packages/tool-runtime/src/tool_schemas.ts]
 */

import { assertEquals } from "@std/assert";
import { runCli, validateAciDocs } from "../../scripts/validate_aci_docs.ts";
import { createCoreToolSchemas } from "@exaix/tool-runtime";
import type { ITool } from "@exaix/core/types";
import { ToolSideEffectScope } from "@exaix/core";

/** A minimal, schema-valid ITool fixture — mirrors the real catalog's own shape. */
function compliantTool(name: string): ITool {
  return {
    name,
    description: "test tool",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    sideEffectScope: ToolSideEffectScope.NONE,
    aciDoc: {
      summary: `Reads something using ${name}.`,
      when_to_use: `Use ${name} when you need this specific capability for a real task.`,
      when_not_to_use: `Do not use ${name} for unrelated capabilities handled by other tools.`,
      example: {
        input: { path: "src/example.ts" },
        output: "ok",
        rationale: "A realistic worked example matching the tool's own schema.",
      },
      anti_example: {
        input: { wrong_key: "src/example.ts" },
        why_wrong: "Uses an unknown parameter name instead of the real one.",
      },
    },
  };
}

Deno.test("[validateAciDocs] a fully compliant catalog reports zero issues", () => {
  const result = validateAciDocs([compliantTool("read_file"), compliantTool("write_file")]);
  assertEquals(result.issues, []);
  assertEquals(result.checkedTools, 2);
});

Deno.test("[validateAciDocs] a tool missing aciDoc is reported with reason missing_aci_doc", () => {
  const broken: ITool = {
    name: "broken_tool",
    description: "test",
    parameters: { type: "object", properties: {}, required: [] },
  };
  const result = validateAciDocs([broken]);
  assertEquals(result.issues.length, 1);
  assertEquals(result.issues[0].tool, "broken_tool");
  assertEquals(result.issues[0].reason, "missing_aci_doc");
});

Deno.test("[validateAciDocs] an invalid aciDoc (fails AciDocSchema) is reported with reason invalid_aci_doc_schema", () => {
  const invalid: ITool = {
    ...compliantTool("invalid_tool"),
    aciDoc: {
      // summary below AciDocSchema's minimum length — invalid.
      summary: "x",
      when_to_use: "x".repeat(20),
      when_not_to_use: "x".repeat(20),
      example: { input: {}, output: "ok", rationale: "x".repeat(20) },
      anti_example: { input: {}, why_wrong: "x".repeat(20) },
    },
  };
  const result = validateAciDocs([invalid]);
  assertEquals(result.issues.length, 1);
  assertEquals(result.issues[0].tool, "invalid_tool");
  assertEquals(result.issues[0].reason.startsWith("invalid_aci_doc_schema"), true);
});

Deno.test("[validateAciDocs] a worked example incompatible with the tool's own parameter schema is reported", () => {
  const badExample: ITool = {
    ...compliantTool("bad_example_tool"),
    aciDoc: {
      ...compliantTool("bad_example_tool").aciDoc!,
      example: {
        input: { nonexistent_param: "value" },
        output: "ok",
        rationale: "x".repeat(20),
      },
    },
  };
  const result = validateAciDocs([badExample]);
  assertEquals(result.issues.length, 1);
  assertEquals(result.issues[0].reason.startsWith("example_incompatible_with_schema"), true);
});

Deno.test("[validateAciDocs] an anti-example that does NOT violate any constraint is reported (it must genuinely be wrong)", () => {
  const weakAntiExample: ITool = {
    ...compliantTool("weak_anti_example_tool"),
    aciDoc: {
      ...compliantTool("weak_anti_example_tool").aciDoc!,
      anti_example: {
        // Fully schema-compatible input — this anti-example proves nothing.
        input: { path: "src/example.ts" },
        why_wrong: "x".repeat(20),
      },
    },
  };
  const result = validateAciDocs([weakAntiExample]);
  assertEquals(result.issues.length, 1);
  assertEquals(result.issues[0].reason, "anti_example_not_a_violation");
});

Deno.test("[validateAciDocs] a newly added tool with valid docs is compliant alongside the existing set", () => {
  const result = validateAciDocs([compliantTool("read_file"), compliantTool("brand_new_tool")]);
  assertEquals(result.issues, []);
  assertEquals(result.checkedTools, 2);
});

Deno.test("[validateAciDocs] a renamed tool is validated under its current name only — no memory of a prior name", () => {
  // "Renamed" is simply: the same object shape under a different `name`. There is no rename
  // tracking, allowlist, or prior-name reference anywhere in the checker's inputs or outputs.
  const result = validateAciDocs([compliantTool("read_file_v2")]);
  assertEquals(result.issues, []);
  assertEquals(result.checkedTools, 1);
});

Deno.test("[validateAciDocs] a tool absent from the input array produces no issue about it — no removed-tool tracking", () => {
  const result = validateAciDocs([compliantTool("still_here")]);
  assertEquals(result.issues.every((i) => i.tool !== "long_removed_tool"), true);
  assertEquals(result.checkedTools, 1);
});

Deno.test("[validateAciDocs] an internal-only-shaped ITool (no MCP-specific fields) is validated identically to any other", () => {
  // ITool carries no docs_visible/MCP-kind field at all — validateAciDocs's signature only
  // ever sees ITool[], so MCP manifest visibility cannot influence its output by construction.
  const result = validateAciDocs([compliantTool("grep_search")]);
  assertEquals(result.issues, []);
});

Deno.test("[validateAciDocs] output is sorted by tool name regardless of input order (stable, deterministic ordering)", () => {
  const brokenA: ITool = {
    name: "zzz_tool",
    description: "test",
    parameters: { type: "object", properties: {}, required: [] },
  };
  const brokenB: ITool = {
    name: "aaa_tool",
    description: "test",
    parameters: { type: "object", properties: {}, required: [] },
  };
  const result = validateAciDocs([brokenA, brokenB]);
  assertEquals(result.issues.map((i) => i.tool), ["aaa_tool", "zzz_tool"]);
});

Deno.test("[validateAciDocs] real createCoreToolSchemas() catalog is fully compliant (18/18)", () => {
  const result = validateAciDocs(createCoreToolSchemas());
  assertEquals(result.issues, []);
  assertEquals(result.checkedTools, 18);
});

// runCli: exit-code wrapper

Deno.test("[runCli] a compliant catalog exits 0 in both default and strict mode", () => {
  const load = () => [compliantTool("read_file")];
  assertEquals(runCli(load, false), 0);
  assertEquals(runCli(load, true), 0);
});

Deno.test("[runCli] a non-compliant catalog in default mode warns and exits 0", () => {
  const load = (): ITool[] => [{
    name: "broken",
    description: "test",
    parameters: { type: "object", properties: {}, required: [] },
  }];
  assertEquals(runCli(load, false), 0);
});

Deno.test("[runCli] a non-compliant catalog in strict mode errors and exits 2", () => {
  const load = (): ITool[] => [{
    name: "broken",
    description: "test",
    parameters: { type: "object", properties: {}, required: [] },
  }];
  assertEquals(runCli(load, true), 2);
});

Deno.test("[runCli] a catalog-load failure exits 1 regardless of strict mode", () => {
  const load = (): ITool[] => {
    throw new Error("catalog failed to load");
  };
  assertEquals(runCli(load, false), 1);
  assertEquals(runCli(load, true), 1);
});

Deno.test("[runCli] strict mode passes for the real 18-tool catalog", () => {
  assertEquals(runCli(createCoreToolSchemas, true), 0);
});
