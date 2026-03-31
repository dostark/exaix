/**
 * @module PortalMultiSupportTest
 * @path tests/services/portal/portal_multi_support_test.ts
 * @description Verifies multi-portal Git repository validation, ensuring correct detection
 * of repository roots and resilient handling of malformed portal targets.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { PortalPermissionsService } from "../../../src/services/portal/portal_permissions.ts";
import type { IPortalPermissions } from "../../../src/shared/schemas/portal_permissions.ts";
import { PortalOperation, SecurityMode } from "../../../src/shared/enums.ts";

/**
 * Helper to create test portal configuration
 */
function createTestPortal(alias: string, targetPath: string): IPortalPermissions {
  return {
    alias,
    target_path: targetPath,
    identities_allowed: ["*"],
    operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
    security: {
      mode: SecurityMode.SANDBOXED,
      audit_enabled: true,
      log_all_actions: true,
    },
  };
}

/**
 * Helper to create temporary test directories with git repos
 */
async function setupTestPortalsWithGit(): Promise<{
  portals: IPortalPermissions[];
  cleanup: () => Promise<void>;
}> {
  const tempDir = await Deno.makeTempDir({ prefix: "exaix_portal_multi_test_" });

  // Create portal with git repo
  const portalWithGit = join(tempDir, "portal-with-git");
  await Deno.mkdir(portalWithGit, { recursive: true });
  await Deno.mkdir(join(portalWithGit, ".git"), { recursive: true });

  // Create portal without git repo
  const portalWithoutGit = join(tempDir, "portal-without-git");
  await Deno.mkdir(portalWithoutGit, { recursive: true });

  // Create another portal with git repo
  const anotherPortalWithGit = join(tempDir, "another-portal-with-git");
  await Deno.mkdir(anotherPortalWithGit, { recursive: true });
  await Deno.mkdir(join(anotherPortalWithGit, ".git"), { recursive: true });

  const portals = [
    createTestPortal("portal-with-git", portalWithGit),
    createTestPortal("portal-without-git", portalWithoutGit),
    createTestPortal("another-portal-with-git", anotherPortalWithGit),
  ];

  const cleanup = async () => {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return { portals, cleanup };
}

Deno.test("[portal-multi] validateGitRepo() returns true for portal with .git directory", async () => {
  const { portals, cleanup } = await setupTestPortalsWithGit();

  try {
    const service = new PortalPermissionsService(portals);

    const hasGit = service.validateGitRepo("portal-with-git");

    assertEquals(hasGit, true, "Portal with .git directory should be valid");
  } finally {
    await cleanup();
  }
});

Deno.test("[portal-multi] validateGitRepo() returns false for portal without .git directory", async () => {
  const { portals, cleanup } = await setupTestPortalsWithGit();

  try {
    const service = new PortalPermissionsService(portals);

    const hasGit = service.validateGitRepo("portal-without-git");

    assertEquals(hasGit, false, "Portal without .git directory should be invalid");
  } finally {
    await cleanup();
  }
});

Deno.test("[portal-multi] validateGitRepo() throws for non-existent portal", async () => {
  const { portals, cleanup } = await setupTestPortalsWithGit();

  try {
    const service = new PortalPermissionsService(portals);

    let errorThrown = false;
    try {
      service.validateGitRepo("non-existent-portal");
    } catch (error: unknown) {
      errorThrown = true;
      const err = error as Error;
      assertEquals(
        err.message,
        "Portal 'non-existent-portal' not found",
        "Should throw error for non-existent portal",
      );
    }

    assertEquals(errorThrown, true, "Should throw error for non-existent portal");
  } finally {
    await cleanup();
  }
});

Deno.test("[portal-multi] listGitEnabledPortals() returns only portals with git repos", async () => {
  const { portals, cleanup } = await setupTestPortalsWithGit();

  try {
    const service = new PortalPermissionsService(portals);

    const gitPortals = service.listGitEnabledPortals();

    assertEquals(gitPortals.length, 2, "Should return 2 git-enabled portals");
    assertEquals(
      gitPortals.some((p) => p.alias === "portal-with-git"),
      true,
      "Should include portal-with-git",
    );
    assertEquals(
      gitPortals.some((p) => p.alias === "another-portal-with-git"),
      true,
      "Should include another-portal-with-git",
    );
    assertEquals(
      gitPortals.some((p) => p.alias === "portal-without-git"),
      false,
      "Should not include portal-without-git",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[portal-multi] listGitEnabledPortals() returns empty array when no git portals exist", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exaix_portal_multi_no_git_" });

  try {
    // Create only portals without git
    const portal1 = join(tempDir, "portal1");
    const portal2 = join(tempDir, "portal2");
    await Deno.mkdir(portal1, { recursive: true });
    await Deno.mkdir(portal2, { recursive: true });

    const portals = [
      createTestPortal("portal1", portal1),
      createTestPortal("portal2", portal2),
    ];

    const service = new PortalPermissionsService(portals);

    const gitPortals = service.listGitEnabledPortals();

    assertEquals(gitPortals.length, 0, "Should return empty array when no git portals exist");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[portal-multi] listGitEnabledPortals() returns all portals when all have git", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exaix_portal_multi_all_git_" });

  try {
    // Create portals all with git
    const portal1 = join(tempDir, "portal1");
    const portal2 = join(tempDir, "portal2");
    const portal3 = join(tempDir, "portal3");
    await Deno.mkdir(join(portal1, ".git"), { recursive: true });
    await Deno.mkdir(join(portal2, ".git"), { recursive: true });
    await Deno.mkdir(join(portal3, ".git"), { recursive: true });

    const portals = [
      createTestPortal("portal1", portal1),
      createTestPortal("portal2", portal2),
      createTestPortal("portal3", portal3),
    ];

    const service = new PortalPermissionsService(portals);

    const gitPortals = service.listGitEnabledPortals();

    assertEquals(gitPortals.length, 3, "Should return all 3 git-enabled portals");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[portal-multi] Multiple portals can be queried simultaneously", async () => {
  const { portals, cleanup } = await setupTestPortalsWithGit();

  try {
    const service = new PortalPermissionsService(portals);

    // Validate multiple portals concurrently
    const result1 = service.validateGitRepo("portal-with-git");
    const result2 = service.validateGitRepo("portal-without-git");
    const result3 = service.validateGitRepo("another-portal-with-git");

    assertEquals(result1, true, "First portal should be valid");
    assertEquals(result2, false, "Second portal should be invalid");
    assertEquals(result3, true, "Third portal should be valid");
  } finally {
    await cleanup();
  }
});
