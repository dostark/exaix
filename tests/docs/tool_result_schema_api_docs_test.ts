/**
 * @module ToolResultSchemaApiDocsTest
 * @path tests/docs/tool_result_schema_api_docs_test.ts
 * @description Verifies that the result-schema discovery surface is documented
 * for operators and integrators, including request shape and response limits.
 * (Phase 78 Step 78.11)
 */

import { assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const TOOLS_MD_PATH = join(Deno.cwd(), "TOOLS.md");
const README_MD_PATH = join(Deno.cwd(), "README.md");

async function readDoc(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

Deno.test("tool_result_schema_api_docs: tools docs describe the result_schema request and descriptor fields", async () => {
  const tools = await readDoc(TOOLS_MD_PATH);

  assertStringIncludes(tools, "exaix/tools/result_schema");
  assertStringIncludes(tools, "tool name");
  assertStringIncludes(tools, "schemaVersion");
  assertStringIncludes(tools, "envelopeSchema");
  assertStringIncludes(tools, "resultSchema");
  assertStringIncludes(tools, "remediationPolicy");
});

Deno.test("tool_result_schema_api_docs: docs explain discovery surface is additive and introspective", async () => {
  const tools = await readDoc(TOOLS_MD_PATH);
  const readme = await readDoc(README_MD_PATH);

  assertStringIncludes(tools, "does not execute the tool");
  assertStringIncludes(tools, "JSON-safe descriptor");
  assertStringIncludes(tools, "same canonical metadata used for runtime validation");
  assertStringIncludes(readme, "inspect expected tool result schemas before calling a tool");
});
