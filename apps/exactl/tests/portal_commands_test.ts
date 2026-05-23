/**
 * @module PortalCommandsTest
 * @path apps/exactl/tests/portal_commands_test.ts
 * @description Verifies CLI commands for portal repository management, including portal
 * addition/removal, alias validation, and connection testing.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { PortalStatus, VerificationStatus } from "@exaix/core";
import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { PortalCommands } from "../src/commands/portal_commands.ts";
import {
  createTestPortal,
  getPortalCardPath,
  getPortalSymlinkPath,
  initPortalTest,
  verifyContextCard,
  verifySymlink,
} from "./helpers/test_setup.ts";
import { createPortalConfigTestContext } from "../../../tests/helpers/portal_test_helper.ts";

Deno.test("PortalCommands: adds portal successfully", async () => {
  const { tempRoot, targetDir, commands, cleanup } = await initPortalTest({
    targetFiles: {
      "README.md": "# Test Project",
      "package.json": '{"name":"test"}',
    },
  });
  try {
    await createTestPortal(commands, targetDir, "TestPortal");

    assertEquals(await verifySymlink(tempRoot, "TestPortal"), true);
    assertEquals(await verifyContextCard(tempRoot, "TestPortal"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: rejects non-existent target path", async () => {
  const { tempRoot, commands, cleanup } = await initPortalTest({ createTarget: false });
  try {
    await assertRejects(
      async () => await commands.add("/nonexistent/path", "BadPortal"),
      Error,
      "Target path does not exist",
    );

    assertEquals(await verifySymlink(tempRoot, "BadPortal"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: rejects invalid alias characters", async () => {
  const { targetDir, commands, cleanup } = await initPortalTest();
  try {
    await assertRejects(
      async () => await commands.add(targetDir, "Bad Portal!"),
      Error,
      "invalid characters",
    );

    await assertRejects(
      async () => await commands.add(targetDir, "123Start"),
      Error,
      "cannot start with a number",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: rejects reserved alias names", async () => {
  const { targetDir, commands, cleanup } = await initPortalTest();
  try {
    await assertRejects(
      async () => await commands.add(targetDir, "Memory"),
      Error,
      "Alias 'Memory' is reserved",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: rejects unsafe default_branch", async () => {
  const { targetDir, commands, cleanup } = await initPortalTest();
  try {
    await assertRejects(
      async () =>
        await commands.add(targetDir, "BadDefaultBranch", {
          defaultBranch: "not a branch",
        }),
      Error,
      "Invalid default_branch",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: rejects duplicate alias", async () => {
  const env1 = await initPortalTest();
  const env2 = await initPortalTest();
  try {
    await createTestPortal(env1.commands, env1.targetDir, "DupePortal");

    await assertRejects(
      async () => await env1.commands.add(env2.targetDir, "DupePortal"),
      Error,
      "already exists",
    );
  } finally {
    await env1.cleanup();
    await env2.cleanup();
  }
});

Deno.test("PortalCommands: lists all portals with status", async () => {
  const env1 = await initPortalTest();
  const env2 = await initPortalTest();
  try {
    await createTestPortal(env1.commands, env1.targetDir, "Portal1");
    await createTestPortal(env1.commands, env2.targetDir, "Portal2");

    const portals = await env1.commands.list();

    assertEquals(portals.length, 2);

    portals.sort((a, b: { alias: string }) => a.alias.localeCompare(b.alias));

    assertEquals(portals[0].alias, "Portal1");
    assertEquals(portals[0].status, PortalStatus.ACTIVE);
    assertEquals(portals[1].alias, "Portal2");
    assertEquals(portals[1].status, PortalStatus.ACTIVE);
  } finally {
    await env1.cleanup();
    await env2.cleanup();
  }
});

Deno.test("PortalCommands: detects broken portals", async () => {
  const { targetDir, commands, cleanup } = await initPortalTest();
  try {
    await createTestPortal(commands, targetDir, "BrokenPortal");

    await Deno.remove(targetDir, { recursive: true });

    const portals = await commands.list();

    assertEquals(portals.length, 1);
    assertEquals(portals[0].alias, "BrokenPortal");
    assertEquals(portals[0].status, "broken");
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: shows portal details", async () => {
  const { targetDir, commands, cleanup } = await initPortalTest();
  try {
    await createTestPortal(commands, targetDir, "ShowPortal");

    const details = await commands.show("ShowPortal");

    assertExists(details);
    assertEquals(details.alias, "ShowPortal");
    assertEquals(details.status, PortalStatus.ACTIVE);
    assertEquals(details.targetPath, targetDir);
    assertExists(details.symlinkPath);
    assertExists(details.contextCardPath);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: show throws error for non-existent portal", async () => {
  const { commands, cleanup } = await initPortalTest({ createTarget: false });
  try {
    await assertRejects(
      async () => await commands.show("NonExistent"),
      Error,
      "not found",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: removes portal and archives context card", async () => {
  const { tempRoot, targetDir, commands, cleanup } = await initPortalTest();
  try {
    await createTestPortal(commands, targetDir, "RemovePortal");

    await commands.remove("RemovePortal");

    assertEquals(await verifySymlink(tempRoot, "RemovePortal"), false);

    const archivedDir = join(tempRoot, "Memory", "Projects", "_archived");
    const archivedExists = await Deno.stat(archivedDir).then(() => true).catch(() => false);
    assertEquals(archivedExists, true);

    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: remove with --keep-card preserves context card", async () => {
  const { tempRoot, targetDir, commands, cleanup } = await initPortalTest();
  try {
    await createTestPortal(commands, targetDir, "KeepCardPortal");

    await commands.remove("KeepCardPortal", { keepCard: true });

    assertEquals(await verifyContextCard(tempRoot, "KeepCardPortal"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: verifies all portals", async () => {
  const env1 = await initPortalTest();
  const env2 = await initPortalTest();
  try {
    await createTestPortal(env1.commands, env1.targetDir, "Portal1");
    await createTestPortal(env1.commands, env2.targetDir, "Portal2");

    await Deno.remove(env2.targetDir, { recursive: true });

    const results = await env1.commands.verify();

    assertEquals(results.length, 2);

    interface TestPortal {
      alias: string;
      status: string;
      issues?: string[];
    }
    const portal1 = results.find((r: TestPortal) => r.alias === "Portal1");
    const portal2 = results.find((r: TestPortal) => r.alias === "Portal2");

    assertExists(portal1);
    assertEquals(portal1.status, "ok");

    assertExists(portal2);
    assertEquals(portal2.status, VerificationStatus.FAILED);
    assertExists(portal2.issues);
    assertEquals(portal2.issues!.length > 0, true);
  } finally {
    await env1.cleanup();
    await env2.cleanup();
  }
});

Deno.test("PortalCommands: verifies specific portal", async () => {
  const { targetDir, commands, cleanup } = await initPortalTest();
  try {
    await createTestPortal(commands, targetDir, "VerifyPortal");

    const results = await commands.verify("VerifyPortal");

    assertEquals(results.length, 1);
    assertEquals(results[0].alias, "VerifyPortal");
    assertEquals(results[0].status, "ok");
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: refresh regenerates context card", async () => {
  const { targetDir, commands, cleanup } = await initPortalTest();
  try {
    await createTestPortal(commands, targetDir, "RefreshPortal");

    await Deno.writeTextFile(join(targetDir, "NEW_FILE.md"), "# New Feature");

    await commands.refresh("RefreshPortal");

    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: handles missing database gracefully", async () => {
  const { targetDir, context, cleanup } = await initPortalTest();
  try {
    const commands = new PortalCommands(context);
    await commands.add(targetDir, "NoDB");

    const portals = await commands.list();
    assertEquals(portals.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: rejects target that is a file not directory", async () => {
  const { commands, cleanup } = await initPortalTest({ createTarget: false });
  const targetFile = await Deno.makeTempFile({ prefix: "portal-file-" });
  try {
    await assertRejects(
      async () => await commands.add(targetFile, "FilePortal"),
      Error,
      "not a directory",
    );
  } finally {
    await cleanup();
    await Deno.remove(targetFile).catch(() => {});
  }
});

Deno.test("PortalCommands: rejects empty alias", async () => {
  const { targetDir, commands, cleanup } = await initPortalTest();
  try {
    await assertRejects(
      async () => await commands.add(targetDir, ""),
      Error,
      "Alias cannot be empty",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: rejects alias exceeding 50 characters", async () => {
  const { targetDir, commands, cleanup } = await initPortalTest();
  try {
    const longAlias = "a".repeat(51);
    await assertRejects(
      async () => await commands.add(targetDir, longAlias),
      Error,
      "cannot exceed 50 characters",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: list handles empty portals directory", async () => {
  const { commands, cleanup } = await initPortalTest({ createTarget: false });
  try {
    const portals = await commands.list();

    assertEquals(portals.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: list skips non-symlink entries", async () => {
  const { tempRoot, commands, cleanup } = await initPortalTest({ createTarget: false });
  try {
    await Deno.writeTextFile(join(tempRoot, "Portals", "README.md"), "Not a portal");

    const portals = await commands.list();

    assertEquals(portals.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: show handles broken symlink with unknown target", async () => {
  const { targetDir, commands, cleanup } = await initPortalTest();
  try {
    await createTestPortal(commands, targetDir, "BrokenShow");

    await Deno.remove(targetDir, { recursive: true });

    const details = await commands.show("BrokenShow");

    assertEquals(details.status, "broken");
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: show detects read-only permissions", async () => {
  const { targetDir, commands, cleanup } = await initPortalTest();
  try {
    await createTestPortal(commands, targetDir, "ReadOnlyPortal");

    await Deno.chmod(targetDir, 0o555);

    const details = await commands.show("ReadOnlyPortal");

    assertExists(details.permissions);

    await Deno.chmod(targetDir, 0o755);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: remove handles missing context card gracefully", async () => {
  const { tempRoot, targetDir, commands, cleanup } = await initPortalTest();
  try {
    await createTestPortal(commands, targetDir, "NoCard");

    const cardPath = getPortalCardPath(tempRoot, "NoCard");
    await Deno.remove(cardPath);

    await commands.remove("NoCard");

    assertEquals(await verifySymlink(tempRoot, "NoCard"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: verify detects missing symlink", async () => {
  const { tempRoot, targetDir, commands, cleanup } = await initPortalTest();
  try {
    await createTestPortal(commands, targetDir, "NoSymlink");

    const symlinkPath = getPortalSymlinkPath(tempRoot, "NoSymlink");
    await Deno.remove(symlinkPath);

    const results = await commands.verify("NoSymlink");

    assertEquals(results.length, 1);
    assertEquals(results[0].status, VerificationStatus.FAILED);
    assertExists(results[0].issues);
    assertEquals(results[0].issues!.some((i: string) => i.includes("Symlink")), true);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: verify detects missing context card", async () => {
  const { tempRoot, targetDir, commands, cleanup } = await initPortalTest();
  try {
    await createTestPortal(commands, targetDir, "NoCardVerify");

    const cardPath = getPortalCardPath(tempRoot, "NoCardVerify");
    await Deno.remove(cardPath);

    const results = await commands.verify("NoCardVerify");

    assertEquals(results.length, 1);
    assertEquals(results[0].status, VerificationStatus.FAILED);
    assertExists(results[0].issues);
    assertEquals(results[0].issues!.some((i: string) => i.includes("Context card")), true);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: rollback on symlink creation failure", async () => {
  const { tempRoot, targetDir, commands, cleanup } = await initPortalTest();
  try {
    const symlinkPath = getPortalSymlinkPath(tempRoot, "RollbackTest");
    await Deno.writeTextFile(symlinkPath, "existing file");

    try {
      await commands.add(targetDir, "RollbackTest");
      assertEquals(true, false, "Should have thrown error");
    } catch (error) {
      assertExists(error);
    }

    const content = await Deno.readTextFile(symlinkPath);
    assertEquals(content, "existing file");
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: adds portal to config file", async () => {
  const { helper, cleanup } = await createPortalConfigTestContext("config-add");
  try {
    await helper.addPortal("ConfigTest");

    // Verify portal was added to config
    const portals = helper.configService.getPortals();
    assertEquals(portals.length, 1);
    assertEquals(portals[0].alias, "ConfigTest");
    assertEquals(portals[0].target_path, helper.targetDir);
    assertExists(portals[0].created);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: removes portal from config file", async () => {
  const { helper, cleanup } = await createPortalConfigTestContext("config-remove");
  try {
    // Add portal
    await helper.addPortal("RemoveTest");
    assertEquals(helper.configService.getPortals().length, 1);

    // Remove portal
    await helper.removePortal("RemoveTest");

    // Verify portal was removed from config
    const portals = helper.configService.getPortals();
    assertEquals(portals.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: list includes created timestamp from config", async () => {
  const { helper, cleanup } = await createPortalConfigTestContext("timestamp");
  try {
    await helper.addPortal("TimestampTest");

    // Get fresh commands with updated config
    const commandsRefreshed = helper.getRefreshedCommands();

    // List portals and verify timestamp
    const portals = await commandsRefreshed.list();
    assertEquals(portals.length, 1);
    assertExists(portals[0].created);

    // Verify timestamp is valid ISO string
    const date = new Date(portals[0].created!);
    assertEquals(isNaN(date.getTime()), false);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalCommands: verify detects config mismatch", async () => {
  const { helper, cleanup } = await createPortalConfigTestContext("verify-config");
  const wrongDir = await helper.createAdditionalTarget();
  try {
    // Add portal normally
    await helper.addPortal("MismatchTest");

    // Manually change symlink to point elsewhere
    const symlinkPath = helper.getSymlinkPath("MismatchTest");

    // Check if symlink exists first
    try {
      await Deno.lstat(symlinkPath);
      await Deno.remove(symlinkPath);
      await Deno.symlink(wrongDir, symlinkPath);
    } catch (_error) {
      // If symlink doesn't exist, just create it
      await Deno.symlink(wrongDir, symlinkPath);
    }

    // Verify should detect mismatch
    const results = await helper.verifyPortal("MismatchTest");
    assertEquals(results.length, 1);
    assertEquals(results[0].status, VerificationStatus.FAILED);
    assertExists(results[0].issues);
    assertEquals(
      results[0].issues!.some((i: string) => i.includes("Config mismatch")),
      true,
    );
  } finally {
    await cleanup([wrongDir]);
  }
});

Deno.test("PortalCommands: verify detects missing config entry", async () => {
  const { helper, cleanup } = await createPortalConfigTestContext("verify-missing");
  try {
    // Create symlink manually without adding to config
    const symlinkPath = helper.getSymlinkPath("Orphaned");
    await Deno.symlink(helper.targetDir, symlinkPath);

    // Create context card
    const cardPath = helper.getCardPath("Orphaned");
    await ensureDir(dirname(cardPath));
    await Deno.writeTextFile(cardPath, "# Orphaned Portal");

    // Verify should detect missing config
    const results = await helper.verifyPortal("Orphaned");
    assertEquals(results.length, 1);
    assertEquals(results[0].status, VerificationStatus.FAILED);
    assertExists(results[0].issues);
    assertEquals(
      results[0].issues!.some((i: string) => i.includes("not found in configuration")),
      true,
    );
  } finally {
    await cleanup();
  }
});
