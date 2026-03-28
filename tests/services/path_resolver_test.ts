/**
 * @module PathResolverTest
 * @path tests/path_resolver_test.ts
 * @description Verifies the core PathResolver logic, ensuring correct resolution of
 * portal alias paths and strict prevention of path traversal security attacks.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { MemoryReferenceType } from "../../src/shared/enums.ts";
import type { ActivityRecord } from "../../src/services/db.ts";
import { initTestDbService } from "../helpers/db.ts";
import { join } from "@std/path";
import { PathResolver } from "../../src/services/path_resolver.ts";
import { createMockConfig } from "../helpers/config.ts";

/**
 * Tests for Step 2.3: Path Security & Portal Resolver
 *
 * Success Criteria:
 * - Test 1: Resolve valid alias path → Returns absolute system path.
 * - Test 2: Path traversal attempt (@Portal/../../secret) → Throws SecurityError.
 * - Test 3: Accessing file outside allowed roots → Throws SecurityError.
 * - Test 4: Unknown alias (@Unknown/file.txt) → Throws error.
 * - Test 5: Root path itself is valid (@Portal/) → Returns portal root path.
 */

Deno.test("PathResolver: resolves valid alias path", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-" });
  try {
    const blueprintsDir = join(tempDir, "Blueprints");
    await Deno.mkdir(blueprintsDir);
    const testFile = join(blueprintsDir, "agent.md");
    await Deno.writeTextFile(testFile, "content");

    const config = createMockConfig(tempDir);

    const resolver = new PathResolver(config);
    const resolved = await resolver.resolve("@Blueprints/agent.md");

    assertEquals(resolved, testFile);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[security] PathResolver: throws on path traversal attempt", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-traversal-" });
  try {
    const blueprintsDir = join(tempDir, "Blueprints");
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
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[security] PathResolver: throws on accessing file outside allowed roots", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-outside-" });
  try {
    const blueprintsDir = join(tempDir, "Blueprints");
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

    // Try to resolve the symlink which points outside
    await assertRejects(
      async () => {
        await resolver.resolve("@Blueprints/link_to_secret");
      },
      Error,
      "Access denied",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PathResolver: throws on unknown alias", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-unknown-" });
  try {
    const config = createMockConfig(tempDir);

    const resolver = new PathResolver(config);

    await assertRejects(
      async () => {
        await resolver.resolve("@Unknown/file.txt");
      },
      Error,
      "Unknown portal alias",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PathResolver: root path itself is valid", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-root-" });
  try {
    const blueprintsDir = join(tempDir, "Blueprints");
    await Deno.mkdir(blueprintsDir);

    const config = createMockConfig(tempDir);

    const resolver = new PathResolver(config);
    const resolved = await resolver.resolve("@Blueprints/");

    // Should resolve to the directory itself (without trailing slash usually, depending on join)
    // Deno.realPath will return the canonical path
    const expected = await Deno.realPath(blueprintsDir);
    assertEquals(resolved, expected);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Additional Security Tests
// ============================================================================

Deno.test("PathResolver: rejects path without @ alias", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-no-alias-" });
  try {
    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    await assertRejects(
      async () => {
        await resolver.resolve("Blueprints/agent.md");
      },
      Error,
      "Path must start with a portal alias",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[security] PathResolver: rejects absolute path attempt", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-absolute-" });
  try {
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
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[security] PathResolver: handles Windows-style path traversal", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-windows-" });
  try {
    const blueprintsDir = join(tempDir, "Blueprints");
    await Deno.mkdir(blueprintsDir);
    const secretFile = join(tempDir, "secret.txt");
    await Deno.writeTextFile(secretFile, "secret");

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    // Try Windows-style path traversal
    // Note: On Unix, backslash is treated as filename character, not separator
    // So it will try to find a file literally named "..\\secret.txt"
    await assertRejects(
      async () => {
        await resolver.resolve("@Blueprints/..\\secret.txt");
      },
      Deno.errors.NotFound, // File doesn't exist with backslash in name
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[security] PathResolver: handles multiple path traversal attempts", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-multi-" });
  try {
    const blueprintsDir = join(tempDir, "Blueprints");
    await Deno.mkdir(blueprintsDir);
    const secretFile = join(tempDir, "secret.txt");
    await Deno.writeTextFile(secretFile, "secret");

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    // Try multiple ../ attempts - these resolve outside temp dir so file won't exist
    await assertRejects(
      async () => {
        await resolver.resolve("@Blueprints/../../../secret.txt");
      },
      Deno.errors.NotFound, // Path doesn't exist after multiple traversals
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PathResolver: handles non-existent file in valid directory", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-nonexist-" });
  try {
    const blueprintsDir = join(tempDir, "Blueprints");
    await Deno.mkdir(blueprintsDir);

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    // Try to resolve a non-existent file
    await assertRejects(
      async () => {
        await resolver.resolve("@Blueprints/nonexistent.md");
      },
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PathResolver: resolves nested directories", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-nested-" });
  try {
    const nestedDir = join(tempDir, "Memory", "deep", "nested");
    await Deno.mkdir(nestedDir, { recursive: true });
    const testFile = join(nestedDir, "file.md");
    await Deno.writeTextFile(testFile, "content");

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    const resolved = await resolver.resolve("@Memory/deep/nested/file.md");
    assertEquals(resolved, await Deno.realPath(testFile));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PathResolver: resolves all valid aliases", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-aliases-" });
  try {
    // Create all directories
    const workspaceDir = join(tempDir, "Workspace");
    const memoryDir = join(tempDir, "Memory");
    const runtimeDir = join(tempDir, ".exa");
    const blueprintsDir = join(tempDir, "Blueprints");

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
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PathResolver: handles special characters in filenames", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-special-" });
  try {
    const blueprintsDir = join(tempDir, "Blueprints");
    await Deno.mkdir(blueprintsDir);
    const testFile = join(blueprintsDir, "file with spaces.md");
    await Deno.writeTextFile(testFile, "content");

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    const resolved = await resolver.resolve("@Blueprints/file with spaces.md");
    assertEquals(resolved, await Deno.realPath(testFile));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PathResolver: handles unicode in paths", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-unicode-" });
  try {
    const blueprintsDir = join(tempDir, "Blueprints");
    await Deno.mkdir(blueprintsDir);
    const testFile = join(blueprintsDir, "文件.md");
    await Deno.writeTextFile(testFile, "content");

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    const resolved = await resolver.resolve("@Blueprints/文件.md");
    assertEquals(resolved, await Deno.realPath(testFile));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PathResolver: rejects empty path after alias", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-empty-" });
  try {
    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    // "@Blueprints" without trailing slash or path - will cause join to fail
    await assertRejects(
      async () => {
        await resolver.resolve("@Blueprints");
      },
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// IActivity Logging Tests
// ============================================================================

Deno.test("[security] PathResolver: logs security violations to console when no DB", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-log-" });
  try {
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
      assertEquals(warnMessage.includes("[SECURITY]"), true);
      assertEquals(warnMessage.includes("path.invalid_alias"), true);
    } finally {
      console.warn = originalWarn;
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// IActivity Logging with Database Tests
// ============================================================================

Deno.test("PathResolver: logs successful resolution to database", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-db-success-" });
  const { db, cleanup } = await initTestDbService();
  try {
    const blueprintsDir = join(tempDir, "Blueprints");
    await Deno.mkdir(blueprintsDir);
    const testFile = join(blueprintsDir, "logged.md");
    await Deno.writeTextFile(testFile, "content");

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config, { db, traceId: "path-trace-123" });

    const resolved = await resolver.resolve("@Blueprints/logged.md");
    assertEquals(resolved, testFile);

    // Wait for batched logs
    await new Promise((resolve) => setTimeout(resolve, 150));

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
    const resolver = new PathResolver(config, { db, traceId: "path-fail-trace" });

    await assertRejects(
      async () => {
        await resolver.resolve("@Unknown/file.txt");
      },
      Error,
      "Unknown portal alias",
    );

    // Wait for batched logs
    await new Promise((resolve) => setTimeout(resolve, 150));

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
    const blueprintsDir = join(tempDir, "Blueprints");
    await Deno.mkdir(blueprintsDir);
    const secretFile = join(tempDir, "secret.txt");
    await Deno.writeTextFile(secretFile, "secret");

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config, { db, traceId: "security-trace" });

    await assertRejects(
      async () => {
        await resolver.resolve("@Blueprints/../secret.txt");
      },
      Error,
      "Access denied",
    );

    // Wait for batched logs
    await new Promise((resolve) => setTimeout(resolve, 150));

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

Deno.test("PathResolver: handles database logging errors gracefully", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "resolver-test-db-error-" });
  const { db, cleanup } = await initTestDbService();
  try {
    const blueprintsDir = join(tempDir, "Blueprints");
    await Deno.mkdir(blueprintsDir);
    const testFile = join(blueprintsDir, "test.md");
    await Deno.writeTextFile(testFile, "content");

    const config = createMockConfig(tempDir);

    // Close DB to simulate logging failure
    await db.close();

    // Create resolver with closed DB - should not throw
    const resolver = new PathResolver(config, { db, traceId: "error-trace" });

    // Capture console.error
    const originalError = console.error;
    let _errorLogged = false;
    console.error = () => {
      _errorLogged = true;
    };

    try {
      // This should still work even with DB errors
      const resolved = await resolver.resolve("@Blueprints/test.md");
      assertEquals(resolved, testFile);
      // May or may not have logged error depending on timing
    } finally {
      console.error = originalError;
    }
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});
