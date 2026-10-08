/**
 * @module SetupHooksSecurityTest
 * @path tests/scripts/setup_hooks_security_test.ts
 * @description Verifies that hook installation fails outside a Git repository.
 * @architectural-layer Test
 * @related-files [scripts/setup_hooks.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

Deno.test("[security] rejects hook installation outside a Git repository", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-all", fromFileUrl(new URL("../../scripts/setup_hooks.ts", import.meta.url))],
      cwd: tmpDir,
    }).output();
    assertEquals(result.success, false);
    assert(new TextDecoder().decode(result.stderr).includes("Cannot resolve Git hooks"));
    assertEquals([...Deno.readDirSync(tmpDir)], []);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
