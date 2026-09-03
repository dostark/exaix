/**
 * @module PathResolverSymlinkSecurityTest
 * @path packages/portal/tests/path_resolver_symlink_security_test.ts
 * @related-files [packages/portal/src/path_resolver.ts]
 * @architectural-layer Services
 * @description Security regression for Finding 8 (Exaix_Security_Vulnerability_Analysis.md).
 * PathResolver.resolve must resolve symlinks on the TARGET path (not only on the root)
 * before the within-root check, so an in-portal symlink that points outside the portal
 * is rejected. A string-prefix check passes such paths because it never follows symlinks.
 */

import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";

Deno.test("security: PathResolver rejects an in-portal symlink that escapes the portal root", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "path-resolver-symlink-" });
  try {
    const portalDir = join(tempDir, "Project");
    const outsideDir = join(tempDir, "outside");
    await Deno.mkdir(portalDir, { recursive: true });
    await Deno.mkdir(outsideDir, { recursive: true });
    await Deno.writeTextFile(join(outsideDir, "secret.txt"), "TOPSECRET");
    // A symlink inside the portal pointing outside it.
    await Deno.symlink(outsideDir, join(portalDir, "escape"));

    const config = createMockConfig(tempDir);
    config.portals = [
      {
        alias: "Project",
        target_path: portalDir,
        default_branch: TEST_DEFAULT_BRANCH,
        agents_allowed: ["*"],
        operations: [],
      },
    ];

    const resolver = new PathResolver(config);

    await assertRejects(
      () => resolver.resolve("@Project/escape/secret.txt"),
      Error,
      "Access denied",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("security: PathResolver error message does not leak absolute host paths (Finding 10)", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "path-resolver-leak-" });
  try {
    const portalDir = join(tempDir, "Project");
    const outsideDir = join(tempDir, "outside");
    await Deno.mkdir(portalDir, { recursive: true });
    await Deno.mkdir(outsideDir, { recursive: true });
    await Deno.symlink(outsideDir, join(portalDir, "escape"));

    const config = createMockConfig(tempDir);
    config.portals = [
      {
        alias: "Project",
        target_path: portalDir,
        default_branch: TEST_DEFAULT_BRANCH,
        agents_allowed: ["*"],
        operations: [],
      },
    ];
    const resolver = new PathResolver(config);

    const error = await resolver.resolve("@Project/escape/secret.txt").then(() => null).catch((e) => e);
    assertInstanceOf(error, Error);
    // The caller-facing message must not disclose absolute host filesystem paths.
    assertEquals(
      error.message.includes(tempDir),
      false,
      `error message leaked an absolute host path: ${error.message}`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("security: PathResolver still resolves a legitimate in-portal path", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "path-resolver-ok-" });
  try {
    const portalDir = join(tempDir, "Project");
    await Deno.mkdir(join(portalDir, "src"), { recursive: true });
    await Deno.writeTextFile(join(portalDir, "src", "main.ts"), "export const x = 1;");

    const config = createMockConfig(tempDir);
    config.portals = [
      {
        alias: "Project",
        target_path: portalDir,
        default_branch: TEST_DEFAULT_BRANCH,
        agents_allowed: ["*"],
        operations: [],
      },
    ];

    const resolver = new PathResolver(config);
    // Must not throw for a real path within the portal.
    await resolver.resolve("@Project/src/main.ts");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
