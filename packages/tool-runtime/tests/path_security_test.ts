/**
 * @module PathSecurityTest
 * @path packages/tool-runtime/tests/path_security_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description Verifies the package-owned path security implementation.
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { PathAccessError, PathSecurity, PathTraversalError } from "@exaix/tool-runtime";
import { join } from "@std/path";

Deno.test("[PathSecurity] normalizePath removes duplicate separators and blocks traversal", () => {
  assertEquals(PathSecurity.normalizePath("foo//bar\\baz"), "foo/bar/baz");
  assertThrows(
    () => PathSecurity.normalizePath("../etc/passwd"),
    PathTraversalError,
  );
});

Deno.test("[PathSecurity] resolveWithinRoots allows files under an allowed root", async () => {
  const rootDir = await Deno.makeTempDir({ prefix: "tool-runtime-path-root-" });
  const allowedRoot = join(rootDir, "workspace");
  const target = join(allowedRoot, "nested", "file.txt");

  try {
    await Deno.mkdir(join(allowedRoot, "nested"), { recursive: true });
    await Deno.writeTextFile(target, "ok");

    const resolved = await PathSecurity.resolveWithinRoots(target, [allowedRoot], rootDir);
    assertEquals(resolved, await Deno.realPath(target));
  } finally {
    await Deno.remove(rootDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("[PathSecurity] resolveWithinRoots allows new files beneath an allowed ancestor", async () => {
  const rootDir = await Deno.makeTempDir({ prefix: "tool-runtime-path-create-" });
  const allowedRoot = join(rootDir, "workspace");
  const target = join(allowedRoot, "nested", "new-file.txt");

  try {
    await Deno.mkdir(join(allowedRoot, "nested"), { recursive: true });

    const resolved = await PathSecurity.resolveWithinRoots(target, [allowedRoot], rootDir);
    assertEquals(resolved, target);
  } finally {
    await Deno.remove(rootDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("[PathSecurity] resolveWithinRoots blocks paths outside allowed roots", async () => {
  const rootDir = await Deno.makeTempDir({ prefix: "tool-runtime-path-deny-" });
  const allowedRoot = join(rootDir, "workspace");
  const blockedRoot = join(rootDir, "outside");
  const target = join(blockedRoot, "secret.txt");

  try {
    await Deno.mkdir(blockedRoot, { recursive: true });
    await Deno.writeTextFile(target, "secret");

    await assertRejects(
      () => PathSecurity.resolveWithinRoots(target, [allowedRoot], rootDir),
      PathAccessError,
    );
  } finally {
    await Deno.remove(rootDir, { recursive: true }).catch(() => {});
  }
});
