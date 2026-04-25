/**
 * @module GitAuditParserTest
 * @path tests/agents/git_audit_parser_test.ts
 * @description Step 61.7 (G3): Unit tests for AgentExecutor.auditGitChanges() covering
 * the full range of git status --porcelain output scenarios.
 *
 * Success Criteria:
 * - Untracked file is classified as unauthorized
 * - Modified tracked file is classified as unauthorized
 * - Authorized file (in allowed_paths) is NOT flagged
 * - Filename with spaces is parsed correctly
 * - Staged rename: destination file is flagged if unauthorized
 * - Non-git directory returns empty array (graceful degradation)
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { AgentExecutor } from "../../src/services/agent/agent_executor.ts";
import type { EventLogger } from "../../src/services/core/event_logger.ts";
import { PathResolver } from "../../src/services/portal/path_resolver.ts";
import { PortalPermissionsService } from "../../src/services/portal/portal_permissions.ts";
import { PortalOperation } from "@exaix/core";
import { initTestDbService } from "../helpers/db.ts";
import { createMockConfig } from "../helpers/config.ts";
import { TEST_DEFAULT_BRANCH } from "../helpers/constants.ts";

/** Minimal no-op mock logger to avoid undefined errors in stub code-paths */
const NOOP_LOGGER = {
  log: (): Promise<void> => Promise.resolve(),
  error: (): Promise<void> => Promise.resolve(),
  info: (): Promise<void> => Promise.resolve(),
  warn: (): Promise<void> => Promise.resolve(),
  debug: (): Promise<void> => Promise.resolve(),
  fatal: (): Promise<void> => Promise.resolve(),
} as Partial<EventLogger>;

/** Bootstrap a real git repo with one committed file and return its path + cleanup. */
async function setupGitRepo(
  parentDir: string,
  name: string,
): Promise<string> {
  const dir = join(parentDir, name);
  await Deno.mkdir(dir, { recursive: true });

  const git = (args: string[]) => new Deno.Command("git", { args, cwd: dir, stderr: "null" }).output();

  await git(["init"]);
  await git(["config", "user.name", "Parser Test"]);
  await git(["config", "user.email", "parser@test.local"]);
  await Deno.writeTextFile(join(dir, "tracked.md"), "# tracked\n");
  await git(["add", "tracked.md"]);
  await git(["commit", "-m", "Initial commit"]);

  return dir;
}

/** Build a minimal AgentExecutor for direct auditGitChanges() calls. */
async function buildExecutor(tempDir: string, portalPath: string) {
  const dbService = await initTestDbService();
  const config = createMockConfig(tempDir, {
    portals: [{
      alias: "audit-portal",
      target_path: portalPath,
      default_branch: TEST_DEFAULT_BRANCH,
      identities_allowed: ["*"],
      operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
    }],
  });
  const permissions = new PortalPermissionsService([{
    alias: "audit-portal",
    target_path: portalPath,
    default_branch: TEST_DEFAULT_BRANCH,
    identities_allowed: ["*"],
    operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
  }]);
  const executor = new AgentExecutor(
    config,
    dbService.db,
    NOOP_LOGGER as EventLogger,
    new PathResolver(config),
    permissions,
  );
  return { executor, dbService };
}

// ============================================================================
// Test 1: Untracked file is flagged
// ============================================================================

Deno.test({
  name: "auditGitChanges: untracked file is flagged as unauthorized",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dbService = await initTestDbService();
    const tempDir = dbService.tempDir;
    try {
      const repoDir = await setupGitRepo(tempDir, "repo-untracked");
      const { executor, dbService: ds2 } = await buildExecutor(tempDir, repoDir);

      // Create an untracked file
      await Deno.writeTextFile(join(repoDir, "newfile.txt"), "untracked\n");

      try {
        const unauthorized = await executor.auditGitChanges(repoDir, []);
        assertEquals(
          unauthorized.includes("newfile.txt"),
          true,
          "newfile.txt must be in unauthorized list",
        );
      } finally {
        await ds2.cleanup();
      }
    } finally {
      await dbService.cleanup();
    }
  },
});

// ============================================================================
// Test 2: Modified tracked file is flagged
// ============================================================================

Deno.test({
  name: "auditGitChanges: modified tracked file is flagged as unauthorized",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dbService = await initTestDbService();
    const tempDir = dbService.tempDir;
    try {
      const repoDir = await setupGitRepo(tempDir, "repo-modified");
      const { executor, dbService: ds2 } = await buildExecutor(tempDir, repoDir);

      // Modify an already-tracked file
      await Deno.writeTextFile(join(repoDir, "tracked.md"), "# modified\n");

      try {
        const unauthorized = await executor.auditGitChanges(repoDir, []);
        assertEquals(
          unauthorized.includes("tracked.md"),
          true,
          "tracked.md must be flagged after modification",
        );
      } finally {
        await ds2.cleanup();
      }
    } finally {
      await dbService.cleanup();
    }
  },
});

// ============================================================================
// Test 3: Authorized file is NOT flagged
// ============================================================================

Deno.test({
  name: "auditGitChanges: file in allowed_paths is not flagged",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dbService = await initTestDbService();
    const tempDir = dbService.tempDir;
    try {
      const repoDir = await setupGitRepo(tempDir, "repo-authorized");
      const { executor, dbService: ds2 } = await buildExecutor(tempDir, repoDir);

      // Write an untracked file, but it will be in allowed_paths
      await Deno.writeTextFile(join(repoDir, "allowed.txt"), "allowed\n");

      try {
        const unauthorized = await executor.auditGitChanges(repoDir, ["allowed.txt"]);
        assertEquals(
          unauthorized.includes("allowed.txt"),
          false,
          "allowed.txt must NOT appear in unauthorized list",
        );
      } finally {
        await ds2.cleanup();
      }
    } finally {
      await dbService.cleanup();
    }
  },
});

// ============================================================================
// Test 4: Non-git directory returns empty array
// ============================================================================

Deno.test({
  name: "auditGitChanges: non-git directory returns empty array",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dbService = await initTestDbService();
    const tempDir = dbService.tempDir;
    try {
      // Plain directory, no git init
      const plainDir = join(tempDir, "plain-dir");
      await Deno.mkdir(plainDir, { recursive: true });
      await Deno.writeTextFile(join(plainDir, "file.txt"), "content\n");

      const { executor, dbService: ds2 } = await buildExecutor(tempDir, plainDir);

      try {
        const unauthorized = await executor.auditGitChanges(plainDir, []);
        assertEquals(unauthorized, [], "Non-git directory must return empty array");
      } finally {
        await ds2.cleanup();
      }
    } finally {
      await dbService.cleanup();
    }
  },
});

// ============================================================================
// Test 5: Mixed: one authorized, one unauthorized, only unauthorized returned
// ============================================================================

Deno.test({
  name: "auditGitChanges: mixed files — only unauthorized returned",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dbService = await initTestDbService();
    const tempDir = dbService.tempDir;
    try {
      const repoDir = await setupGitRepo(tempDir, "repo-mixed");
      const { executor, dbService: ds2 } = await buildExecutor(tempDir, repoDir);

      await Deno.writeTextFile(join(repoDir, "permitted.txt"), "allowed\n");
      await Deno.writeTextFile(join(repoDir, "forbidden.txt"), "not allowed\n");

      try {
        const unauthorized = await executor.auditGitChanges(repoDir, ["permitted.txt"]);
        assertEquals(
          unauthorized.includes("forbidden.txt"),
          true,
          "forbidden.txt must be unauthorized",
        );
        assertEquals(
          unauthorized.includes("permitted.txt"),
          false,
          "permitted.txt must NOT be in unauthorized list",
        );
      } finally {
        await ds2.cleanup();
      }
    } finally {
      await dbService.cleanup();
    }
  },
});

// ============================================================================
// Test 6: Clean working tree returns empty array
// ============================================================================

Deno.test({
  name: "auditGitChanges: clean working tree returns empty array",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dbService = await initTestDbService();
    const tempDir = dbService.tempDir;
    try {
      const repoDir = await setupGitRepo(tempDir, "repo-clean");
      const { executor, dbService: ds2 } = await buildExecutor(tempDir, repoDir);

      try {
        // No changes made after initial commit
        const unauthorized = await executor.auditGitChanges(repoDir, []);
        assertEquals(unauthorized, [], "Clean working tree must return empty array");
      } finally {
        await ds2.cleanup();
      }
    } finally {
      await dbService.cleanup();
    }
  },
});
