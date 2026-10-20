/**
 * @module CheckMagicValuesClassificationTest
 * @path tests/scripts/check_magic_values_classification_test.ts
 * @description Proves that check:magic and check:style classify the same paths identically.
 * @architectural-layer Test
 * @related-files [packages/lint-policy/src/checkers/check_magic_values.ts, packages/lint-policy/src/checkers/check_code_style.ts]
 */

import { assertEquals } from "@std/assert";
import { classifyRepoPath as classifyMagicPath } from "../../packages/lint-policy/src/checkers/check_magic_values.ts";
import { classifyRepoPath as classifyStylePath } from "../../packages/lint-policy/src/checkers/check_code_style.ts";

Deno.test("check:magic and check:style classify the same path list identically", () => {
  const paths = [
    "packages/core/src/a.ts",
    "packages/core/tests/a_test.ts",
    "packages/core/src/a.test.ts",
    "apps/tui/src/a.tsx",
    "tests/scenario_framework/fixtures/a.ts",
    "packages/core/tests/fixtures/a.ts",
    "tests/scripts/a.ts",
    "scripts/a.ts",
  ];
  for (const path of paths) {
    assertEquals(
      classifyMagicPath(path),
      classifyStylePath(path),
      `both gates must classify ${path} identically`,
    );
  }
});
