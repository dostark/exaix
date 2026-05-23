/**
 * @module CheckTestPlacementTest
 * @path tests/scripts/check_test_placement_test.ts
 * @description Unit tests for the test-placement enforcement script.
 */

import { assertEquals } from "@std/assert";
import {
  getTestPlacementIssue,
  recommendTestDirectoryForSource,
  validateTestPlacement,
} from "../../scripts/check_test_placement.ts";

Deno.test("validateTestPlacement: accepts correctly placed service tests", () => {
  const result = validateTestPlacement([
    "tests/services/agent/agent_executor_test.ts",
    "tests/schemas/flow_schema_test.ts",
  ]);

  assertEquals(result.success, true);
  assertEquals(result.issues.length, 0);
});

Deno.test("getTestPlacementIssue: rejects test files outside tests/", () => {
  const issue = getTestPlacementIssue("src/services/agent/agent_executor_test.ts");

  assertEquals(issue?.message, "Test files must live under tests/, packages/<package>/tests/, or apps/<app>/tests/.");
  assertEquals(issue?.suggestion, "tests/services/agent/");
});

Deno.test("getTestPlacementIssue: rejects direct tests/services root files", () => {
  const issue = getTestPlacementIssue("tests/services/agent_executor_test.ts");

  assertEquals(
    issue?.message,
    "Service tests must live under tests/services/<domain>/, not directly under tests/services/.",
  );
  assertEquals(issue?.suggestion, "Move this file into the appropriate domain folder under tests/services/.");
});

Deno.test("recommendTestDirectoryForSource: maps common source folders to test folders", () => {
  assertEquals(recommendTestDirectoryForSource("src/services/flow/flow_namespace_service.ts"), "tests/services/flow/");
  assertEquals(recommendTestDirectoryForSource("@exaix/schemas/flow.ts"), "tests/schemas/");
  assertEquals(recommendTestDirectoryForSource("scripts/check_test_placement.ts"), "tests/scripts/");
});

Deno.test("validateTestPlacement: ignores non-test files in mixed input", () => {
  const result = validateTestPlacement([
    "src/services/agent/agent_executor.ts",
    "tests/services/agent/agent_executor_test.ts",
  ]);

  assertEquals(result.success, true);
  assertEquals(result.inspectedPaths.length, 1);
});

Deno.test("recommendTestDirectoryForSource: maps package sources to package tests", () => {
  assertEquals(
    recommendTestDirectoryForSource("packages/schemas/src/flow.ts"),
    "packages/schemas/tests/",
  );
});

Deno.test("getTestPlacementIssue: accepts package-local tests", () => {
  const issue = getTestPlacementIssue("packages/schemas/tests/request_analysis_test.ts");
  assertEquals(issue, null);
});
