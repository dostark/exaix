/**
 * @module ToolRegistryPatchFileShapeTest
 * @path packages/tool-runtime/tests/tool_registry_patch_file_shape_test.ts
 * @description Phase 154 Step 4: `ToolRegistry`'s `patch_file` previously accepted
 *   `{path, patches: [{search, replace}]}` (an array of sequential patches) while the live MCP
 *   handler (`packages-team/mcp-server/handlers/patch_file_tool.ts`) accepts the flat
 *   `{path, search, replace}` shape and requires the search string to match exactly once. This
 *   test file replaces patch_file_test.ts: it verifies the new flat shape (matching the MCP
 *   handler's contract and exact-occurrence validation) and that the retired array shape is no
 *   longer silently accepted.
 * @related-files [packages/tool-runtime/src/tool_registry.ts, packages/tool-runtime/src/tool_schemas.ts, packages-team/mcp-server/handlers/patch_file_tool.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { JSONObject } from "@exaix/core/types";
import { cleanupTempDir, createToolRegistryForTests } from "./helpers.ts";
import { ToolName } from "@exaix/core";

Deno.test("ToolRegistry: patch_file (flat search/replace shape)", async (t) => {
  const tempDir = await Deno.makeTempDir();
  const registry = createToolRegistryForTests(tempDir);

  const file = join(tempDir, "test.ts");
  const initialContent = `
    function hello() {
      console.log("Hello World");
    }
  `;
  await Deno.writeTextFile(file, initialContent);

  await t.step("applies a flat {path, search, replace} patch", async () => {
    const result = await registry.execute(ToolName.PATCH_FILE, {
      path: "test.ts",
      search: 'console.log("Hello World");',
      replace: 'console.log("Goodbye World");',
    });

    assertEquals(result.success, true);
    const data = result.data as JSONObject;
    assertEquals(data.path, "test.ts");

    const content = await Deno.readTextFile(file);
    assertEquals(content.includes('console.log("Goodbye World");'), true);
    assertEquals(content.includes('console.log("Hello World");'), false);
  });

  await t.step("fails if search string is not found", async () => {
    const result = await registry.execute(ToolName.PATCH_FILE, {
      path: "test.ts",
      search: "non-existent",
      replace: "foo",
    });

    assertEquals(result.success, false);
    assertEquals(result.error?.includes("not found"), true);
  });

  await t.step("fails if search string matches more than once (ambiguous)", async () => {
    const ambiguousFile = join(tempDir, "ambiguous.ts");
    await Deno.writeTextFile(ambiguousFile, "dup();\ndup();\n");

    const result = await registry.execute(ToolName.PATCH_FILE, {
      path: "ambiguous.ts",
      search: "dup();",
      replace: "single();",
    });

    assertEquals(result.success, false);
    assertEquals(result.error?.includes("multiple") || result.error?.includes("ambiguous"), true);
  });

  await t.step(
    "the retired {path, patches: [...]} array shape now fails validation, not silently accepted",
    async () => {
      const beforeContent = await Deno.readTextFile(file);

      const result = await registry.execute(ToolName.PATCH_FILE, {
        path: "test.ts",
        patches: [{ search: "function hello()", replace: "function bye()" }],
      });

      assertEquals(result.success, false);
      assertEquals(result.error?.includes("search"), true);

      // The file must be untouched — the old array shape must not silently apply anything.
      const afterContent = await Deno.readTextFile(file);
      assertEquals(afterContent, beforeContent);
    },
  );

  await t.step(
    "[regression] writes $-prefixed replacement text literally, not as a special substitution pattern",
    async () => {
      // JS String.prototype.replace() interprets $&, $`, $', $$, and $<digit> in the replacement
      // argument even when the search pattern is a plain string (Phase 154 GAP-6) — patchFile()
      // must write these sequences byte-for-byte, not silently substitute them.
      const cases: Array<{ name: string; replace: string }> = [
        { name: "$&", replace: "matched: $&" },
        { name: "$`", replace: "before: $`" },
        { name: "$'", replace: "after: $'" },
        { name: "$$", replace: "literal dollar: $$" },
        { name: "$1", replace: "group: $1" },
      ];

      for (const [index, { name, replace }] of cases.entries()) {
        const caseFile = join(tempDir, `dollar-${index}.ts`);
        await Deno.writeTextFile(caseFile, "const target = 1;\n");

        const result = await registry.execute(ToolName.PATCH_FILE, {
          path: `dollar-${index}.ts`,
          search: "const target = 1;",
          replace,
        });

        assertEquals(result.success, true, `patch should succeed for case ${name}`);
        const content = await Deno.readTextFile(caseFile);
        assertEquals(content, `${replace}\n`, `case ${name}: replacement text must be written literally`);
      }
    },
  );

  // Cleanup
  await cleanupTempDir(tempDir);
});
