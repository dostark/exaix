/**
 * @module DelegateBriefContentTest
 * @path packages/core/tests/planning/delegate_brief_content_test.ts
 * @description Verifies that buildDelegateBriefArgs produces correct objective and
 *   acceptanceCriteria from step data (Phase 150 Step 1, S1.2 BRIEF_CONTENT).
 */
import { assertEquals } from "@std/assert";
import { buildDelegateBriefArgs } from "@exaix/core/planning";

Deno.test("buildDelegateBriefArgs: uses step content as objective, successCriteria as acceptanceCriteria", () => {
  const result = buildDelegateBriefArgs({
    title: "Add login page",
    content: "Build a login page with email/password and SSO support",
    successCriteria: ["Email/password login works", "SSO login works", "Error states handled"],
  });

  assertEquals(result.objective, "Build a login page with email/password and SSO support");
  assertEquals(result.acceptanceCriteria, ["Email/password login works", "SSO login works", "Error states handled"]);
});

Deno.test("buildDelegateBriefArgs: omits acceptanceCriteria when successCriteria is empty", () => {
  const result = buildDelegateBriefArgs({
    title: "Minor fix",
    content: "Fix the typo in the footer",
  });

  assertEquals(result.objective, "Fix the typo in the footer");
  assertEquals(result.acceptanceCriteria, undefined);
});

Deno.test("buildDelegateBriefArgs: omits acceptanceCriteria when successCriteria is empty array", () => {
  const result = buildDelegateBriefArgs({
    title: "Minor fix",
    content: "Fix the typo in the footer",
    successCriteria: [],
  });

  assertEquals(result.objective, "Fix the typo in the footer");
  assertEquals(result.acceptanceCriteria, undefined);
});
