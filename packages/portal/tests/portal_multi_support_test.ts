/**
 * @module PortalMultiSupportTest
 * @path packages/portal/tests/portal_multi_support_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Verifies multi-portal Git repository validation, ensuring correct detection
 * of repository roots and resilient handling of malformed portal targets.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { PortalPermissionsService } from "@exaix/portal";
import { TestEnvironment } from "@exaix/testing";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";

Deno.test("[portal-multi] validateGitRepo() returns true for portal with .git directory", async () => {
  const env = await TestEnvironment.create();
  try {
    const { config } = await env.setupPortal({
      alias: "portal-with-git",
    });
    const service = new PortalPermissionsService([config]);

    const hasGit = service.validateGitRepo("portal-with-git");

    assertEquals(hasGit, true, "Portal with .git directory should be valid");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[portal-multi] validateGitRepo() returns false for portal without .git directory", async () => {
  const env = await TestEnvironment.create();
  try {
    // We create a directory WITHOUT git repo manually
    const noRepoPath = join(env.tempDir, "portal-without-git");
    await Deno.mkdir(noRepoPath, { recursive: true });

    const config = {
      alias: "portal-without-git",
      target_path: noRepoPath,
      default_branch: TEST_DEFAULT_BRANCH,
      identities_allowed: ["*"],
      operations: [],
    };

    const service = new PortalPermissionsService([config]);

    const hasGit = service.validateGitRepo("portal-without-git");

    assertEquals(hasGit, false, "Portal without .git directory should be invalid");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[portal-multi] validateGitRepo() throws for non-existent portal", async () => {
  const env = await TestEnvironment.create();
  try {
    const { config } = await env.setupPortal({
      alias: "existing-portal",
    });
    const service = new PortalPermissionsService([config]);

    let errorThrown = false;
    try {
      service.validateGitRepo("non-existent");
    } catch (e) {
      errorThrown = true;
      if (e instanceof Error) {
        assertEquals(e.message.includes("Portal 'non-existent' not found"), true);
      }
    }

    assertEquals(errorThrown, true, "Should throw for unknown portal");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[portal-multi] getPortal() returns correct path in target_path", async () => {
  const env = await TestEnvironment.create();
  try {
    const { config, portalDir } = await env.setupPortal({
      alias: "test-portal",
    });
    const service = new PortalPermissionsService([config]);

    const portal = service.getPortal("test-portal");

    assertEquals(portal?.target_path, portalDir);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[portal-multi] listPortalAliases() returns all configured portals", async () => {
  const env = await TestEnvironment.create();
  try {
    const p1 = await env.setupPortal({ alias: "portal-1" });
    const p2 = await env.setupPortal({ alias: "portal-2" });

    const service = new PortalPermissionsService([p1.config, p2.config]);

    const portals = service.listPortalAliases();

    assertEquals(portals.length, 2);
    assertEquals(portals.includes("portal-1"), true);
    assertEquals(portals.includes("portal-2"), true);
  } finally {
    await env.cleanup();
  }
});
