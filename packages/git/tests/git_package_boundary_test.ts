/**
 * @module GitPackageBoundaryTest
 * @path packages/git/tests/git_package_boundary_test.ts
 * @description Verifies the git package remains the canonical ownership surface for git runtime files.
 */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const TEST_DIR = dirname(fromFileUrl(import.meta.url));
const PACKAGE_ROOT = join(TEST_DIR, "..");

const GIT_PACKAGE_SOURCE_FILES = [
  "src/constants.ts",
  "src/enums.ts",
  "src/i_git_service.ts",
  "src/git_service.ts",
] as const;

Deno.test("git package source files advertise package-owned header paths", async () => {
  for (const relativePath of GIT_PACKAGE_SOURCE_FILES) {
    const source = await Deno.readTextFile(join(PACKAGE_ROOT, relativePath));

    assertEquals(source.includes(`@path packages/git/${relativePath}`), true, relativePath);
  }
});
