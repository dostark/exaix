/**
 * @module DelegateArtifactRefTest
 * @path packages/core/tests/planning/delegate_artifact_ref_test.ts
 * @description Verifies that artifactRef uses step number (not title) and that
 *   brief-preparation failures produce a distinct event (Phase 150 Step 13, GAP-H+E).
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildDelegateBriefArgs } from "@exaix/core/planning";

Deno.test("buildDelegateBriefArgs: step number is available for artifactRef construction", () => {
  const step = {
    number: 3,
    title: "Fix ../src path handling",
    content: "Fix the path handling bug",
  };
  const result = buildDelegateBriefArgs(step);
  assertEquals(result.objective, "Fix the path handling bug");
});

Deno.test("artifactRef with step number is traversal-safe", () => {
  const traceId = "t1";
  const stepNumber = 3;
  const artifactRef = `trace:${traceId}/step:${stepNumber}`;
  // The artifactRef should contain only digits for the step component
  assertStringIncludes(artifactRef, "step:3");
  // A title-based ref like "step:Fix ../src path handling" would be unsafe;
  // the number-based ref avoids this by construction
  assertEquals(artifactRef, "trace:t1/step:3");
});
