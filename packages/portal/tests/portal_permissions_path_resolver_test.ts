/**
 * @module PortalPermissionsTest
 * @path packages/portal/tests/portal_permissions_path_resolver_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Verifies the security enforcement for portal access, ensuring that tools
 * are strictly confined to authorized portal root directories.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";

Deno.test("PathResolver: resolves user-defined portal", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "portal-test-" });
  const externalDir = await Deno.makeTempDir({ prefix: "external-project-" });

  try {
    const testFile = join(externalDir, "main.ts");
    await Deno.writeTextFile(testFile, "console.log('hello')");

    const config = createMockConfig(tempDir);
    config.portals = [
      {
        alias: "MyProject",
        target_path: externalDir,
        default_branch: TEST_DEFAULT_BRANCH,
        identities_allowed: ["*"],
        operations: [],
        created: new Date().toISOString(),
      },
    ];

    const resolver = new PathResolver(config);
    const resolved = await resolver.resolve("@MyProject/main.ts");

    assertEquals(resolved, await Deno.realPath(testFile));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    await Deno.remove(externalDir, { recursive: true });
  }
});

Deno.test("[security] PathResolver: prevents traversal out of user-defined portal", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "portal-test-traversal-" });
  const externalDir = await Deno.makeTempDir({ prefix: "external-project-" });
  const parentDir = join(externalDir, "..");
  const secretFile = join(parentDir, "secret.txt");
  await Deno.writeTextFile(secretFile, "secret");

  try {
    const config = createMockConfig(tempDir);
    config.portals = [
      {
        alias: "MyProject",
        target_path: externalDir,
        default_branch: TEST_DEFAULT_BRANCH,
        identities_allowed: ["*"],
        operations: [],
        created: new Date().toISOString(),
      },
    ];

    const resolver = new PathResolver(config);

    // Try to traverse out of the portal root
    await assertRejects(
      async () => {
        await resolver.resolve("@MyProject/../secret.txt");
      },
      Error,
      "Access denied",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    await Deno.remove(externalDir, { recursive: true });
  }
});

Deno.test("[security] PathResolver: prevents access via symlink out of user-defined portal", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "portal-test-symlink-" });
  const externalDir = await Deno.makeTempDir({ prefix: "external-project-" });
  const secretFile = join(tempDir, "secret.txt");
  await Deno.writeTextFile(secretFile, "secret");

  try {
    // Create symlink inside portal pointing outside
    const symlink = join(externalDir, "link_to_secret");
    await Deno.symlink(secretFile, symlink);

    const config = createMockConfig(tempDir);
    config.portals = [
      {
        alias: "MyProject",
        target_path: externalDir,
        default_branch: TEST_DEFAULT_BRANCH,
        identities_allowed: ["*"],
        operations: [],
        created: new Date().toISOString(),
      },
    ];

    const resolver = new PathResolver(config);

    // The symlink physically points outside the portal root, so resolution must be
    // rejected: PathResolver resolves symlinks on the target before the within-root
    // check (Finding 8). A string-prefix check would wrongly accept this path.
    await assertRejects(
      () => resolver.resolve("@MyProject/link_to_secret"),
      Error,
      "Access denied",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    await Deno.remove(externalDir, { recursive: true });
  }
});
