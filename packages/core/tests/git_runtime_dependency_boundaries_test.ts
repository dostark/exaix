/**
 * @module GitRuntimeDependencyBoundariesTest
 * @path tests/shared/git_runtime_dependency_boundaries_test.ts
 * @description Verifies that git package source files do not add runtime imports to workspace packages beyond @exaix/core.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";

const TEST_DIR = dirname(fromFileUrl(import.meta.url));
const GIT_SRC_DIR = join(TEST_DIR, "..", "..", "git", "src");

function findDisallowedRuntimeWorkspaceImports(source: string): string[] {
  return source
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.startsWith("import "))
    .filter((statement) => !statement.startsWith("import type "))
    .filter((statement) => /from\s+["']@exaix\/(?!core(?:\/|["']))[^"']+["']$/.test(statement));
}

Deno.test("@exaix/git has no runtime imports from workspace packages beyond core", async () => {
  const offenders: string[] = [];

  for await (const entry of walk(GIT_SRC_DIR, { includeDirs: false, exts: [".ts"] })) {
    const text = await Deno.readTextFile(entry.path);
    if (findDisallowedRuntimeWorkspaceImports(text).length > 0) {
      offenders.push(entry.path);
    }
  }

  assertEquals(offenders, []);
});
