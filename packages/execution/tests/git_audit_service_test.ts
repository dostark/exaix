/**
 * @module GitAuditServiceTest
 * @path packages/execution/tests/git_audit_service_test.ts
 * @description Tests for GitAuditService — git audit, SHA resolution,
 *   file path validation, and unauthorized change reversion.
 * @architectural-layer Tests
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { EventLogger } from "@exaix/core/logger";
import { GitAuditService } from "../src/git_audit_service.ts";
import { MemoryOperation, PortalOperation } from "@exaix/core";

async function withTempGitDir(fn: (dir: string, service: GitAuditService) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  const logger = new EventLogger({} as any);
  const service = new GitAuditService(logger);

  try {
    await new Deno.Command(PortalOperation.GIT, { args: ["init"], cwd: dir }).output();
    await new Deno.Command(PortalOperation.GIT, {
      args: ["config", "user.email", "test@test.com"],
      cwd: dir,
    }).output();
    await new Deno.Command(PortalOperation.GIT, {
      args: ["config", "user.name", "Test"],
      cwd: dir,
    }).output();
    await fn(dir, service);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test({
  name: "GitAuditService detects unauthorized changes",
  fn: async () => {
    await withTempGitDir(async (dir, service) => {
      const unauthorizedFile = join(dir, "unauthorized.txt");
      await Deno.writeTextFile(unauthorizedFile, "Unauthorized change");

      const changes = await service.auditGitChanges(dir, []);
      assert(changes.length > 0);
      assert(changes.some((file) => file.includes("unauthorized.txt")));
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GitAuditService reverts unauthorized changes",
  fn: async () => {
    await withTempGitDir(async (dir, service) => {
      const trackedFile = join(dir, "tracked.txt");
      await Deno.writeTextFile(trackedFile, "Original content");
      await new Deno.Command(PortalOperation.GIT, { args: [MemoryOperation.ADD, "tracked.txt"], cwd: dir }).output();
      await new Deno.Command(PortalOperation.GIT, { args: ["commit", "-m", "Add tracked"], cwd: dir }).output();

      await Deno.writeTextFile(trackedFile, "Unauthorized modification");
      const untrackedFile = join(dir, "untracked.txt");
      await Deno.writeTextFile(untrackedFile, "Unauthorized new file");

      const changes = await service.auditGitChanges(dir, []);
      assert(changes.length >= 2);

      await service.revertUnauthorizedChanges(dir, changes);

      const restored = await Deno.readTextFile(trackedFile);
      assertEquals(restored, "Original content");

      let untrackedExists = true;
      try {
        await Deno.stat(untrackedFile);
      } catch {
        untrackedExists = false;
      }
      assertEquals(untrackedExists, false);

      const remaining = await service.auditGitChanges(dir, []);
      assertEquals(remaining.length, 0);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GitAuditService.revertUnauthorizedChanges handles empty list",
  fn: async () => {
    await withTempGitDir(async (_dir, service) => {
      await service.revertUnauthorizedChanges("/tmp", []);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GitAuditService.validateFilePath prevents path traversal",
  fn: async () => {
    await withTempGitDir(async (dir, service) => {
      await Deno.writeTextFile(join(dir, "test.txt"), "content");
      await Deno.mkdir(join(dir, "subdir"));
      await Deno.writeTextFile(join(dir, "subdir", "test.txt"), "content");
      assertEquals(service.validateFilePath("test.txt", dir), "test.txt");
      assertEquals(service.validateFilePath("subdir/test.txt", dir), "subdir/test.txt");
      assert(service.validateFilePath("/etc/passwd", dir) === null, "absolute path rejected");
      assert(service.validateFilePath("../outside.txt", dir) === null, "parent traversal rejected");
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GitAuditService.getPortalHeadSha returns valid SHA",
  fn: async () => {
    await withTempGitDir(async (dir, service) => {
      await Deno.writeTextFile(join(dir, "initial.txt"), "content");
      await new Deno.Command(PortalOperation.GIT, { args: [MemoryOperation.ADD, "initial.txt"], cwd: dir }).output();
      await new Deno.Command(PortalOperation.GIT, { args: ["commit", "-m", "Initial"], cwd: dir }).output();

      const sha = await service.getPortalHeadSha(dir);
      assertEquals(sha.length, 40, "SHA should be 40 hex characters");
      assert(/^[a-f0-9]+$/.test(sha), "SHA should be hexadecimal");
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "GitAuditService returns empty SHA for empty repo",
  fn: async () => {
    await withTempGitDir(async (dir, service) => {
      const EMPTY_SHA = "0000000000000000000000000000000000000000";
      const sha = await service.getPortalHeadSha(dir);
      assertEquals(sha, EMPTY_SHA);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
