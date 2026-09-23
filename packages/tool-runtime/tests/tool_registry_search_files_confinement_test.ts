/**
 * @module ToolRegistrySearchFilesConfinementTest
 * @path packages/tool-runtime/tests/tool_registry_search_files_confinement_test.ts
 * @description [security] search_files must never list paths outside its search root, even when
 * the glob pattern carries `..` segments or an absolute prefix.
 * @architectural-layer Tool Runtime
 * @dependencies [@exaix/tool-runtime, @exaix/testing]
 * @related-files [packages/tool-runtime/src/tool_registry.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";

const ACCESS_DENIED = "Access denied";

async function withPortal(run: (registry: ToolRegistry, root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/portal/src`, { recursive: true });
    await Deno.writeTextFile(`${root}/portal/src/main.ts`, "export const a = 1;\n");
    await Deno.writeTextFile(`${root}/secret.txt`, "OUTSIDE\n");
    const config = createMockConfig(root);
    config.portals = [{ alias: "p", target_path: `${root}/portal` } as never];
    await run(new ToolRegistry({ config, baseDir: `${root}/portal` }), root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("[security] search_files rejects a pattern with .. segments instead of listing outside paths", async () => {
  await withPortal(async (registry) => {
    const result = await registry.execute("search_files", { pattern: "../*.txt", path: "@p/." });
    assertEquals(result.success, false);
    assert(String(result.error).includes(ACCESS_DENIED), `expected access denied, got ${result.error}`);
  });
});

Deno.test("[security] search_files rejects an absolute pattern", async () => {
  await withPortal(async (registry, root) => {
    const result = await registry.execute("search_files", { pattern: `${root}/*.txt`, path: "@p/." });
    assertEquals(result.success, false);
    assert(String(result.error).includes(ACCESS_DENIED), `expected access denied, got ${result.error}`);
  });
});

Deno.test("search_files still returns in-root matches for a normal pattern", async () => {
  await withPortal(async (registry, root) => {
    const result = await registry.execute("search_files", { pattern: "**/*.ts", path: "@p/." });
    assertEquals(result.success, true);
    const files = (result.data as { files: string[] }).files;
    assertEquals(files.length, 1);
    assert(files[0].startsWith(`${root}/portal/`));
  });
});
