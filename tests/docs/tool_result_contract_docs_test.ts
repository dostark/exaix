/**
 * @module ToolResultContractDocsTest
 * @path tests/docs/tool_result_contract_docs_test.ts
 * @description Verifies that the human-facing docs describe the Phase 78 tool
 * result contract: validation boundaries, remediation behavior, and MCP error
 * semantics. (Phase 78 Step 78.11)
 */

import { assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const ARCHITECTURE_MD_PATH = join(Deno.cwd(), "ARCHITECTURE.md");
const TOOLS_MD_PATH = join(Deno.cwd(), "TOOLS.md");
const README_MD_PATH = join(Deno.cwd(), "README.md");

async function readDoc(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

Deno.test("tool_result_contract_docs: architecture documents validation boundaries and remediation limits", async () => {
  const architecture = await readDoc(ARCHITECTURE_MD_PATH);

  assertStringIncludes(architecture, "Tool Result Validation & Discovery");
  assertStringIncludes(architecture, "registry boundary");
  assertStringIncludes(architecture, "MCP boundary");
  assertStringIncludes(architecture, "fail_closed");
  assertStringIncludes(architecture, "normalize_then_validate");
  assertStringIncludes(architecture, "retry_once");
  assertStringIncludes(architecture, "retry_with_backoff");
  assertStringIncludes(architecture, "Mutating tools remain fail-closed");
});

Deno.test("tool_result_contract_docs: tools reference explains structured payload validation and isError semantics", async () => {
  const tools = await readDoc(TOOLS_MD_PATH);

  assertStringIncludes(tools, "Tool Result Schema Contract");
  assertStringIncludes(tools, "exaix_structured_data");
  assertStringIncludes(tools, "exaix/tools/result_schema");
  assertStringIncludes(tools, "isError: true");
  assertStringIncludes(tools, "validation failure");
  assertStringIncludes(tools, "read-only tools may be normalized or retried");
});

Deno.test("tool_result_contract_docs: readme explains operator-facing failure behavior", async () => {
  const readme = await readDoc(README_MD_PATH);

  assertStringIncludes(readme, "Tool result schemas");
  assertStringIncludes(readme, "exaix/tools/result_schema");
  assertStringIncludes(readme, "validation failures are reported as tool-contract errors");
  assertStringIncludes(readme, "isError");
});
