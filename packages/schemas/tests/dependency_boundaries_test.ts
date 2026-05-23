/**
 * @module SchemasDependencyBoundariesTest
 * @path packages/schemas/tests/dependency_boundaries_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Verifies that @exaix/schemas does not import higher-level workspace packages.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";

const TEST_DIR = dirname(fromFileUrl(import.meta.url));
const SCHEMAS_SRC_DIR = join(TEST_DIR, "..", "src");
const WORKSPACE_IMPORT_PATTERN = /from\s+["'](@exaix(?:\/[^"']*)?)["']/g;

Deno.test("@exaix/schemas depends only on core among workspace packages", async () => {
  const offenders: string[] = [];

  for await (const entry of walk(SCHEMAS_SRC_DIR, { includeDirs: false, exts: [".ts"] })) {
    const text = await Deno.readTextFile(entry.path);
    for (const match of text.matchAll(WORKSPACE_IMPORT_PATTERN)) {
      const specifier = match[1];
      if (
        specifier === "@exaix/core" || specifier.startsWith("@exaix/core/") || specifier === "@exaix/schemas" ||
        specifier.startsWith("@exaix/schemas/")
      ) {
        continue;
      }
      offenders.push(`${entry.path} -> ${specifier}`);
    }
  }

  assertEquals(offenders, []);
});
