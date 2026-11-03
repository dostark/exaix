/**
 * @module SetupHooksSecurityTest
 * @path tests/scripts/setup_hooks_security_test.ts
 * @description Verifies that hook installation fails outside a Git repository.
 * @architectural-layer Test
 * @related-files [scripts/setup_hooks.ts]
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { withTempDir } from "@exaix/testing";

Deno.test("[security] rejects hook installation outside a Git repository", async () => {
  await withTempDir(async (tmpDir) => {
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-all", fromFileUrl(new URL("../../scripts/setup_hooks.ts", import.meta.url))],
      cwd: tmpDir,
    }).output();
    assertEquals(result.success, false);
    assertStringIncludes(new TextDecoder().decode(result.stderr), "Cannot resolve Git hooks");
    assertEquals([...Deno.readDirSync(tmpDir)], []);
  });
});
