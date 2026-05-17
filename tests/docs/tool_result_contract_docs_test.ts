/**
 * @module ToolResultContractDocsTest
 * @path tests/docs/tool_result_contract_docs_test.ts
 * @description Verifies that TOOL_MANIFEST entries with output_schema or
 * remediationPolicyRef are consistent with TOOL_RESULT_SCHEMA_REGISTRY and
 * known remediation policy modes (parity checks). Fails when manifest and
 * schema registry drift. (Phase 78 Step 78.5)
 */

import { assert, assertEquals } from "@std/assert";
import { checkToolResultParity, type IParityCheckResult } from "../../scripts/check_tool_result_parity.ts";

Deno.test("tool_result_contract_docs: parity check returns a result object", () => {
  const result: IParityCheckResult = checkToolResultParity();
  assert(typeof result.success === "boolean");
  assert(Array.isArray(result.errors));
  assert(Array.isArray(result.warnings));
});

Deno.test("tool_result_contract_docs: parity check passes for the current manifest", () => {
  const result = checkToolResultParity();
  assertEquals(
    result.success,
    true,
    `Parity check failed:\n${result.errors.join("\n")}`,
  );
});

Deno.test("tool_result_contract_docs: all remediationPolicyRef values reference known modes", () => {
  const result = checkToolResultParity();
  const policyErrors = result.errors.filter((e) => e.includes("remediationPolicyRef"));
  assertEquals(policyErrors.length, 0, `Unknown remediationPolicyRef values found:\n${policyErrors.join("\n")}`);
});

Deno.test("tool_result_contract_docs: checked tool count is positive", () => {
  const result = checkToolResultParity();
  assert(result.checkedTools > 0, "At least one tool must be inspected");
});

Deno.test("tool_result_contract_docs: delegates_to_registry tools with output_schema should have registry entries (warnings, not errors)", () => {
  const result = checkToolResultParity();
  // Warnings for Check 2 are advisory — parity check still succeeds.
  assertEquals(
    result.success,
    true,
    `Parity check must succeed even with Check 2 warnings:\n${result.errors.join("\n")}`,
  );
  // The warnings array may be non-empty; that is expected and acceptable.
  assert(Array.isArray(result.warnings), "warnings must be an array");
});
