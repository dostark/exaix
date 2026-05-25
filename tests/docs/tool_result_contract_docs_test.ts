/**
 * @module ToolResultContractDocsTest
 * @path tests/docs/tool_result_contract_docs_test.ts
 * @description Verifies that the human-facing docs describe the tool result
 * contract: validation boundaries and remediation behavior in ARCHITECTURE.md.
 */

import { assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const ARCHITECTURE_MD_PATH = join(Deno.cwd(), "ARCHITECTURE.md");

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
