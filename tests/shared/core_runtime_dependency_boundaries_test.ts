/**
 * @module CoreRuntimeDependencyBoundariesTest
 * @path tests/shared/core_runtime_dependency_boundaries_test.ts
 * @description Verifies that core source files do not use runtime imports from ai or schemas packages.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";

const TEST_DIR = dirname(fromFileUrl(import.meta.url));
const CORE_SRC_DIR = join(TEST_DIR, "..", "..", "packages", "core", "src");

function findRuntimeWorkspaceImports(source: string): string[] {
  return source
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.startsWith("import "))
    .filter((statement) => !statement.startsWith("import type "))
    .filter((statement) => /from\s+["']@exaix\/(ai|schemas)(?:\/[^"']*)?["']$/.test(statement));
}

Deno.test("@exaix/core has no runtime imports from ai or schemas packages", async () => {
  const offenders: string[] = [];

  for await (const entry of walk(CORE_SRC_DIR, { includeDirs: false, exts: [".ts"] })) {
    const text = await Deno.readTextFile(entry.path);
    if (findRuntimeWorkspaceImports(text).length > 0) {
      offenders.push(entry.path);
    }
  }

  assertEquals(offenders, []);
});
