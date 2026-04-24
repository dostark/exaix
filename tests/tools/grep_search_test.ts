// deno-lint-ignore-file no-explicit-any
/**
 * @module GrepSearchToolTest
 * @path tests/tools/grep_search_test.ts
 * @description Verifies the 'grep_search' tool, ensuring efficient and accurate
 * pattern matching across the project workspace.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { cleanupTempDir, createToolRegistryForTests } from "./helpers.ts";
import { ToolName } from "../../src/shared/enums.ts";

Deno.test("ToolRegistry: grep_search", async (t) => {
  // Setup temp directory with fixtures
  const tempDir = await Deno.makeTempDir();
  const file1 = join(tempDir, "file1.ts");
  const file2 = join(tempDir, "file2.ts");
  const nestedFile = join(tempDir, "src", "nested.ts");
  const excludedFile = join(tempDir, "node_modules", "lib.ts");

  await Deno.mkdir(join(tempDir, "src"), { recursive: true });
  await Deno.mkdir(join(tempDir, "node_modules"), { recursive: true });

  await Deno.writeTextFile(file1, "const foo = 'bar';\nconsole.log(foo);");
  await Deno.writeTextFile(file2, "const baz = 'qux';");
  await Deno.writeTextFile(nestedFile, "export const foo = 123;");
  await Deno.writeTextFile(excludedFile, "const foo = 'hidden';");

  const registry = createToolRegistryForTests(tempDir, {
    tools: {
      grep_search: {
        max_results: 10,
        exclude_dirs: ["node_modules"],
      },
    },
  });

  await t.step("finds pattern in files", async () => {
    const result = await registry.execute(ToolName.GREP_SEARCH, { pattern: "foo", path: "." });
    assertEquals(result.success, true);
    // Should match file1.ts (2 matches if we count literal 'foo' but regex might match differently depending on pattern)
    // grep 'foo' matches 'foo' substring
    // file1.ts:1:const foo = 'bar';
    // file1.ts:2:console.log(foo);
    // src/nested.ts:1:export const foo = 123;

    // Sort logic in grep depends on file system order, but we can check content
    const matches = result.data as Array<{ file: string; line: number; content: string }>;
    assertEquals(matches.length, 3);

    const file1Matches = matches.filter((m) => m.file === "file1.ts");
    assertEquals(file1Matches.length, 2);
    assertEquals(file1Matches[0].line, 1);
    assertEquals(file1Matches[1].line, 2);

    const nestedMatches = matches.filter((m) => m.file === "src/nested.ts");
    assertEquals(nestedMatches.length, 1);
  });

  await t.step("respects exclude_dirs", async () => {
    const result = await registry.execute(ToolName.GREP_SEARCH, { pattern: "hidden", path: "." });
    assertEquals(result.success, true); // grep returns exit code 1 if not found, logic handles it?
    // Wait, implementation says: if (code !== 0 && code !== 1) return error.
    // If no matches (code 1), it returns matches: [].
    // Here we expect NO matches because "hidden" is only in node_modules which is excluded
    const matches = result.data as any[];
    assertEquals(matches.length, 0);
  });

  await t.step("case insensitive by default (config or tool param?)", async () => {
    // Tool default param is caseSensitive=true, but test wrapper might use default.
    // Let's check logic: args default to caseSensitive=true.
    // Test with explicit parameter.
    const result = await registry.execute(ToolName.GREP_SEARCH, { pattern: "FOO", path: ".", case_sensitive: false });
    assertEquals(result.success, true);
    const matches = result.data as any[];
    assertEquals(matches.length > 0, true);
  });

  await t.step("case sensitive enforcement", async () => {
    const result = await registry.execute(ToolName.GREP_SEARCH, { pattern: "FOO", path: ".", case_sensitive: true });
    assertEquals(result.success, true);
    const matches = result.data as any[];
    assertEquals(matches.length, 0);
  });

  // Cleanup
  await cleanupTempDir(tempDir);
});
