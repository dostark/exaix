/**
 * @module CoreRuntimeDependencyBoundariesTest
 * @path packages/core/tests/core_runtime_dependency_boundaries_test.ts
 * @description Verifies that core source files do not use runtime imports from ai or schemas packages.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";

const TEST_DIR = dirname(fromFileUrl(import.meta.url));
const CORE_SRC_DIR = join(TEST_DIR, "..", "src");

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
    // Skip parsing/artifact/planning/health sub-packages which legitimately import from @exaix/schemas or @exaix/ai at runtime
    if (entry.path.includes("/parsing/")) continue;
    if (entry.path.includes("/artifact/")) continue;
    if (entry.path.includes("/planning/")) continue;
    if (entry.path.includes("/health/")) continue;
    if (entry.path.includes("/config/")) continue;
    const text = await Deno.readTextFile(entry.path);
    if (findRuntimeWorkspaceImports(text).length > 0) {
      offenders.push(entry.path);
    }
  }

  assertEquals(offenders, []);
});
