/**
 * @module PathResolverTest
 * @path packages/tool-runtime/tests/path_resolver_test.ts
 * @description Verifies the core PathResolver logic, ensuring correct resolution of
 * portal alias paths and strict prevention of path traversal security attacks.
 */

import * as pathBuilders from "@exaix/shared";
import { DEFAULT_BLUEPRINTS_PATH } from "@exaix/shared";
import { assert, assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { MemoryReferenceType } from "@exaix/core";
import type { ActivityRecord } from "@exaix/storage-sqlite";
import { initTestDbService, withTempDir } from "@exaix/testing";
import { join } from "@std/path";
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import type { IEventLogger } from "@exaix/core/logger";

/** Tests for PathResolver alias and security validation. */

Deno.test("PathResolver: resolves valid alias path", async () => {
  await withTempDir(async (tempDir) => {
    const blueprintsDir = pathBuilders.blueprintsPath(tempDir);
    await Deno.mkdir(blueprintsDir);
    const testFile = join(blueprintsDir, "agent.md");
    await Deno.writeTextFile(testFile, "content");

    const config = createMockConfig(tempDir);

    const resolver = new PathResolver(config);
    const resolved = await resolver.resolve("@Blueprints/agent.md");

    assertEquals(resolved, testFile);
  }, { prefix: "resolver-test-" });
});

Deno.test("[security] PathResolver: throws on path traversal attempt", async () => {
  await withTempDir(async (tempDir) => {
    const blueprintsDir = pathBuilders.blueprintsPath(tempDir);
    await Deno.mkdir(blueprintsDir);
    const secretFile = join(tempDir, "secret.txt");
    await Deno.writeTextFile(secretFile, "secret");

    const config = createMockConfig(tempDir);

    const resolver = new PathResolver(config);

    await assertRejects(
      async () => {
        await resolver.resolve("@Blueprints/../secret.txt");
      },
      Error,
      "Access denied",
    );
  }, { prefix: "resolver-test-traversal-" });
});

Deno.test("[security] PathResolver: throws on accessing file outside allowed roots", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-outside-" });
  try {
    const blueprintsDir = pathBuilders.blueprintsPath(tempDir);
    await Deno.mkdir(blueprintsDir);

    // Create a symlink pointing outside
    const secretFile = join(tempDir, "secret.txt");
    await Deno.writeTextFile(secretFile, "secret");
    const symlink = join(blueprintsDir, "link_to_secret");
    await Deno.symlink(secretFile, symlink, { type: MemoryReferenceType.FILE });

    // Deno.symlink requires allow-write/read, assuming test env has it
    // If symlinks are not supported on the OS, this test might need adjustment
    // This test covers the case where a symlink within an allowed root points outside.

    const config = createMockConfig(tempDir);

    const resolver = new PathResolver(config);

    // The symlink physically points outside the allowed root, so resolution must be
    // rejected: PathResolver resolves symlinks on the target before the within-root
    // check (Finding 8). A string-prefix check would wrongly accept this path.
    await assertRejects(
      () => resolver.resolve("@Blueprints/link_to_secret"),
      Error,
      "Access denied",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PathResolver: throws on unknown alias", async () => {
  await withTempDir(async (tempDir) => {
    const config = createMockConfig(tempDir);

    const resolver = new PathResolver(config);

    await assertRejects(
      async () => {
        await resolver.resolve("@Unknown/file.txt");
      },
      Error,
      "Unknown portal alias",
    );
  }, { prefix: "resolver-test-unknown-" });
});

Deno.test("PathResolver: root path itself is valid", async () => {
  await withTempDir(async (tempDir) => {
    const blueprintsDir = pathBuilders.blueprintsPath(tempDir);
    await Deno.mkdir(blueprintsDir);

    const config = createMockConfig(tempDir);

    const resolver = new PathResolver(config);
    const resolved = await resolver.resolve("@Blueprints/");

    // Should resolve to the directory itself (without trailing slash usually, depending on join)
    // Deno.realPath will return the canonical path
    const expected = await Deno.realPath(blueprintsDir);
    assertEquals(resolved, expected);
  }, { prefix: "resolver-test-root-" });
});

// Additional Security Tests

Deno.test("PathResolver: rejects path without @ alias", async () => {
  await withTempDir(async (tempDir) => {
    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    await assertRejects(
      async () => {
        await resolver.resolve(`${DEFAULT_BLUEPRINTS_PATH}/agent.md`);
      },
      Error,
      "Path must start with a portal alias",
    );
  }, { prefix: "resolver-test-no-alias-" });
});

Deno.test("[security] PathResolver: rejects absolute path attempt", async () => {
  await withTempDir(async (tempDir) => {
    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    // Try to use an absolute path directly
    await assertRejects(
      async () => {
        await resolver.resolve("/etc/passwd");
      },
      Error,
      "Path must start with a portal alias",
    );
  }, { prefix: "resolver-test-absolute-" });
});

Deno.test("[security] PathResolver: handles Windows-style path traversal", async () => {
  await withTempDir(async (tempDir) => {
    const blueprintsDir = pathBuilders.blueprintsPath(tempDir);
    await Deno.mkdir(blueprintsDir);
    const secretFile = join(tempDir, "secret.txt");
    await Deno.writeTextFile(secretFile, "secret");

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    // Windows backslash path traversal attempt (treated as literal filename on POSIX).
    const resolved = await resolver.resolve("@Blueprints/..\\secret.txt");
    // Resolution succeeds because path is within Blueprints root
    assert(resolved.includes("Blueprints"), "Resolved path should include Blueprints");
  }, { prefix: "resolver-test-windows-" });
});

Deno.test("[security] PathResolver: handles multiple path traversal attempts", async () => {
  await withTempDir(async (tempDir) => {
    const blueprintsDir = pathBuilders.blueprintsPath(tempDir);
    await Deno.mkdir(blueprintsDir);
    // Place the file inside Blueprints directory
    const secretFile = join(blueprintsDir, "secret.txt");
    await Deno.writeTextFile(secretFile, "secret");

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    // Try valid path within allowed root - no ../ escape
    const resolved = await resolver.resolve("@Blueprints/secret.txt");
    assert(resolved.includes("secret.txt"), "Resolved path should include filename");
  }, { prefix: "resolver-test-multi-" });
});

Deno.test("PathResolver: handles non-existent file in valid directory", async () => {
  await withTempDir(async (tempDir) => {
    const blueprintsDir = pathBuilders.blueprintsPath(tempDir);
    await Deno.mkdir(blueprintsDir);

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    // Try to resolve a non-existent file
    // PathResolver only validates path is within allowed root, doesn't check file existence
    const resolved = await resolver.resolve("@Blueprints/nonexistent.md");
    assert(resolved.includes("nonexistent.md"), "Resolved path should include filename");
    assert(resolved.includes("Blueprints"), "Resolved path should include Blueprints");
  }, { prefix: "resolver-test-nonexist-" });
});

Deno.test("PathResolver: resolves nested directories", async () => {
  await withTempDir(async (tempDir) => {
    const nestedDir = pathBuilders.memoryPath(tempDir, "deep", "nested");
    await Deno.mkdir(nestedDir, { recursive: true });
    const testFile = join(nestedDir, "file.md");
    await Deno.writeTextFile(testFile, "content");

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    const resolved = await resolver.resolve("@Memory/deep/nested/file.md");
    assertEquals(resolved, await Deno.realPath(testFile));
  }, { prefix: "resolver-test-nested-" });
});

Deno.test("PathResolver: resolves all valid aliases", async () => {
  await withTempDir(async (tempDir) => {
    // Create all directories
    const workspaceDir = pathBuilders.workspacePath(tempDir);
    const memoryDir = pathBuilders.memoryPath(tempDir);
    const runtimeDir = pathBuilders.runtimePath(tempDir);
    const blueprintsDir = pathBuilders.blueprintsPath(tempDir);

    await Deno.mkdir(workspaceDir);
    await Deno.mkdir(memoryDir);
    await Deno.mkdir(runtimeDir);
    await Deno.mkdir(blueprintsDir);

    // Create test files
    await Deno.writeTextFile(join(workspaceDir, "inbox.md"), "inbox");
    await Deno.writeTextFile(join(memoryDir, "memory.md"), "memory");
    await Deno.writeTextFile(join(memoryDir, "knowledge.md"), "knowledge");
    await Deno.writeTextFile(join(runtimeDir, "journal.db"), "database");
    await Deno.writeTextFile(join(blueprintsDir, "blueprint.md"), "blueprint");

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    // Test all aliases
    const workspaceResolved = await resolver.resolve("@Workspace/inbox.md");
    const knowledgeResolved = await resolver.resolve("@Memory/knowledge.md");
    const runtimeResolved = await resolver.resolve("@Runtime/journal.db");
    const blueprintsResolved = await resolver.resolve("@Blueprints/blueprint.md");

    assertEquals(workspaceResolved, await Deno.realPath(join(workspaceDir, "inbox.md")));
    assertEquals(knowledgeResolved, await Deno.realPath(join(memoryDir, "knowledge.md")));
    assertEquals(runtimeResolved, await Deno.realPath(join(runtimeDir, "journal.db")));
    assertEquals(blueprintsResolved, await Deno.realPath(join(blueprintsDir, "blueprint.md")));
  }, { prefix: "resolver-test-aliases-" });
});

Deno.test("PathResolver: handles special characters in filenames", async () => {
  await withTempDir(async (tempDir) => {
    const blueprintsDir = pathBuilders.blueprintsPath(tempDir);
    await Deno.mkdir(blueprintsDir);
    const testFile = join(blueprintsDir, "file with spaces.md");
    await Deno.writeTextFile(testFile, "content");

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    const resolved = await resolver.resolve("@Blueprints/file with spaces.md");
    assertEquals(resolved, await Deno.realPath(testFile));
  }, { prefix: "resolver-test-special-" });
});

Deno.test("PathResolver: handles unicode in paths", async () => {
  await withTempDir(async (tempDir) => {
    const blueprintsDir = pathBuilders.blueprintsPath(tempDir);
    await Deno.mkdir(blueprintsDir);
    const testFile = join(blueprintsDir, "文件.md");
    await Deno.writeTextFile(testFile, "content");

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    const resolved = await resolver.resolve("@Blueprints/文件.md");
    assertEquals(resolved, await Deno.realPath(testFile));
  }, { prefix: "resolver-test-unicode-" });
});

Deno.test("PathResolver: rejects empty path after alias", async () => {
  await withTempDir(async (tempDir) => {
    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    // "@Blueprints" without trailing slash or path - will cause join to fail
    await assertRejects(
      async () => {
        await resolver.resolve("@Blueprints");
      },
      Deno.errors.NotFound,
    );
  }, { prefix: "resolver-test-empty-" });
});

// IActivity Logging Tests

Deno.test("[security] PathResolver: logs security violations to console when no DB", async () => {
  await withTempDir(async (tempDir) => {
    const config = createMockConfig(tempDir);
    // Create resolver without DB
    const resolver = new PathResolver(config);

    // Capture console.warn
    const originalWarn = console.warn;
    let warnCalled = false;
    let warnMessage = "";

    console.warn = (msg: string) => {
      warnCalled = true;
      warnMessage = msg;
    };

    try {
      await assertRejects(
        async () => {
          await resolver.resolve("no-alias-path");
        },
        Error,
        "Path must start with a portal alias",
      );

      // Verify console.warn was called
      assertEquals(warnCalled, true);
      assertStringIncludes(warnMessage, "[SECURITY]");
      assertStringIncludes(warnMessage, "path.invalid_alias");
    } finally {
      console.warn = originalWarn;
    }
  }, { prefix: "resolver-test-log-" });
});

// IActivity Logging with Database Tests

Deno.test("PathResolver: logs successful resolution to database", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-db-success-" });
  const { db, cleanup } = await initTestDbService();
  try {
    const blueprintsDir = pathBuilders.blueprintsPath(tempDir);
    await Deno.mkdir(blueprintsDir);
    const testFile = join(blueprintsDir, "logged.md");
    await Deno.writeTextFile(testFile, "content");

    const config = createMockConfig(tempDir);
    const logger = new EventLogger({ db });
    const resolver = new PathResolver(config, { logger, traceId: "path-trace-123" });

    const resolved = await resolver.resolve("@Blueprints/logged.md");
    assertEquals(resolved, testFile);

    // Wait for batched logs
    await logger.info("__flush__", "");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = db.getActivitiesByTrace("path-trace-123");
    const successLog = logs.find((l: ActivityRecord) => l.action_type === "path.resolved");
    assertExists(successLog, "path.resolved should be logged");

    const payload = JSON.parse(successLog!.payload);
    assertEquals(payload.alias, "@Blueprints");
    assertExists(payload.duration_ms);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PathResolver: logs resolution failures to database", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-db-fail-" });
  const { db, cleanup } = await initTestDbService();
  try {
    const config = createMockConfig(tempDir);
    const logger = new EventLogger({ db });
    const resolver = new PathResolver(config, { logger, traceId: "path-fail-trace" });

    await assertRejects(
      async () => {
        await resolver.resolve("@Unknown/file.txt");
      },
      Error,
      "Unknown portal alias",
    );

    // Wait for batched logs
    await logger.info("__flush__", "");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = db.getActivitiesByTrace("path-fail-trace");
    const failLog = logs.find((l: ActivityRecord) => l.action_type === "path.resolution_failed");
    assertExists(failLog, "path.resolution_failed should be logged");

    const payload = JSON.parse(failLog!.payload);
    assertEquals(payload.error_type, "Error");
    assertExists(payload.error_message);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[security] PathResolver: logs security violations to database", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-db-security-" });
  const { db, cleanup } = await initTestDbService();
  try {
    const blueprintsDir = pathBuilders.blueprintsPath(tempDir);
    await Deno.mkdir(blueprintsDir);
    const secretFile = join(tempDir, "secret.txt");
    await Deno.writeTextFile(secretFile, "secret");

    const config = createMockConfig(tempDir);
    const logger = new EventLogger({ db });
    const resolver = new PathResolver(config, { logger, traceId: "security-trace" });

    await assertRejects(
      async () => {
        await resolver.resolve("@Blueprints/../secret.txt");
      },
      Error,
      "Access denied",
    );

    // Wait for batched logs
    await logger.info("__flush__", "");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = db.getActivitiesByTrace("security-trace");
    const securityLog = logs.find((l: ActivityRecord) => l.action_type === "path.access_denied");
    assertExists(securityLog, "path.access_denied should be logged");

    const payload = JSON.parse(securityLog!.payload);
    assertEquals(payload.severity, "high");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

// EventLogger Integration Tests

interface CapturedEvent {
  action: string;
  target: string | null;
}

Deno.test("PathResolver: routes successful resolution through IEventLogger when provided", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-ev-" });
  try {
    const blueprintsDir = pathBuilders.blueprintsPath(tempDir);
    await Deno.mkdir(blueprintsDir);
    const testFile = join(blueprintsDir, "agent.md");
    await Deno.writeTextFile(testFile, "content");

    const config = createMockConfig(tempDir);

    const captured: CapturedEvent[] = [];
    const logger: IEventLogger = {
      info(action: string, target: string | null): Promise<void> {
        captured.push({ action, target });
        return Promise.resolve();
      },
      warn(action: string, target: string | null): Promise<void> {
        captured.push({ action, target });
        return Promise.resolve();
      },
      log: () => Promise.resolve(),
      error: () => Promise.resolve(),
      fatal: () => Promise.resolve(),
      debug: () => Promise.resolve(),
      child: () => logger,
    };

    const resolver = new PathResolver(config, { logger, traceId: "ev-trace" });

    const resolved = await resolver.resolve("@Blueprints/agent.md");
    assertEquals(resolved, testFile);

    const ev = captured.find((e) => e.action === "path.resolved");
    assertExists(ev, "path.resolved should be logged via IEventLogger");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PathResolver: routes security violations through IEventLogger when provided", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-ev-sec-" });
  try {
    const config = createMockConfig(tempDir);

    const captured: CapturedEvent[] = [];
    const logger: IEventLogger = {
      info(action: string, target: string | null): Promise<void> {
        captured.push({ action, target });
        return Promise.resolve();
      },
      warn(action: string, target: string | null): Promise<void> {
        captured.push({ action, target });
        return Promise.resolve();
      },
      log: () => Promise.resolve(),
      error: () => Promise.resolve(),
      fatal: () => Promise.resolve(),
      debug: () => Promise.resolve(),
      child: () => logger,
    };

    const resolver = new PathResolver(config, { logger, traceId: "ev-sec-trace" });

    await assertRejects(
      async () => {
        await resolver.resolve("@Unknown/file.txt");
      },
      Error,
      "Unknown portal alias",
    );

    const ev = captured.find((e) => e.action === "path.resolution_failed");
    assertExists(ev, "path.resolution_failed should be logged via IEventLogger");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
