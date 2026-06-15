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
    "packages/execution/tests/agent_executor_test.ts",
    "tests/schemas/flow_schema_test.ts",
  ]);

  assertEquals(result.success, true);
  assertEquals(result.issues.length, 0);
});

Deno.test("getTestPlacementIssue: rejects test files outside tests/", () => {
  const issue = getTestPlacementIssue("foo/bar/baz_test.ts");

  assertEquals(
    issue?.message,
    "Test files must live under tests/, packages/<package>/tests/, packages-team/<package>/tests/, or apps/<app>/tests/.",
  );
  assertEquals(
    issue?.suggestion,
    "Move this file under tests/, a package/app tests folder, or packages-team/<package>/tests/.",
  );
});

Deno.test("getTestPlacementIssue: rejects retired directories", () => {
  const issue = getTestPlacementIssue("tests/services/agent_executor_test.ts");

  assertEquals(
    issue?.message,
    "The tests/services/, tests/tools/, tests/unit/, and tests/shared/ directories are retired. Place new tests in packages/<name>/tests/, apps/<app>/tests/, or the appropriate tests/ subdirectory.",
  );
  assertEquals(
    issue?.suggestion,
    "Move this file under packages/<name>/tests/, apps/<app>/tests/, or a remaining tests/ subdirectory.",
  );
});

Deno.test("recommendTestDirectoryForSource: maps common source folders to test folders", () => {
  assertEquals(recommendTestDirectoryForSource("packages/flow/src/flow_namespace_service.ts"), "packages/flow/tests/");
  assertEquals(recommendTestDirectoryForSource("scripts/check_test_placement.ts"), "tests/scripts/");
});

Deno.test("validateTestPlacement: ignores non-test files in mixed input", () => {
  const result = validateTestPlacement([
    "src/services/agent/agent_executor.ts",
    "packages/execution/tests/agent_executor_test.ts",
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
