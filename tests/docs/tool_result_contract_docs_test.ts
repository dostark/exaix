/**
 * @module ToolResultContractDocsTest
 * @path tests/docs/tool_result_contract_docs_test.ts
 * @description Verifies that the execution package README documents the tool result
 * contract: validation boundaries and remediation behavior.
 */

import { assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../..", import.meta.url));
const EXECUTION_README_PATH = join(REPO_ROOT, "packages/execution/README.md");

async function readDoc(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

Deno.test("tool_result_contract_docs: execution docs document validation boundaries and remediation limits", async () => {
  const readme = await readDoc(EXECUTION_README_PATH);

  assertStringIncludes(readme, "Tool Result Validation");
  assertStringIncludes(readme, "fail_closed");
  assertStringIncludes(readme, "normalize_then_validate");
  assertStringIncludes(readme, "retry_once");
  assertStringIncludes(readme, "retry_with_backoff");
  assertStringIncludes(readme, "Mutating tools remain fail-closed");
});
