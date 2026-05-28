/**
 * @module PortalServiceUnitTest
 * @path packages/portal/tests/portal_service_unit_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Unit tests for the core PortalService (src/services/portal.ts).
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { IContextCardGeneratorService, IPortalKnowledgeConfig, IPortalKnowledgeService } from "@exaix/core/types";
import { PortalService } from "@exaix/portal";
import { PortalAnalysisMode, PortalExecutionStrategy, PortalStatus } from "@exaix/core";
import { createMockConfig, createStubConfig, createStubDisplay } from "@exaix/testing";
function createMockContextCardGenerator(): IContextCardGeneratorService {
  return {
    generate: () => Promise.resolve(),
  };
}

async function createPortalTestEnv() {
  const tempDir = await Deno.makeTempDir({ prefix: "portal-svc-" });
  const config = createMockConfig(tempDir);
  const configService = createStubConfig(config);
  const display = createStubDisplay();
  const contextCardGen = createMockContextCardGenerator();

  const mockKnowledge: IPortalKnowledgeService = {
    analyze: (
      alias: string,
      _path: string,
      mode?: PortalAnalysisMode,
    ) =>
      Promise.resolve({
        portal: alias,
        gatheredAt: new Date().toISOString(),
        version: 1,
        architectureOverview: `Analysis for ${alias}`,
        keyFiles: [],
        conventions: [],
        dependencies: [],
        layers: [],
        techStack: { primaryLanguage: "typescript" },
        symbolMap: [],
        stats: { totalFiles: 0, totalDirectories: 0, extensionDistribution: {} },
        metadata: { mode: mode || PortalAnalysisMode.QUICK, durationMs: 0, filesScanned: 0, filesRead: 0 },
      }),
    getOrAnalyze: (portalAlias: string) => mockKnowledge.analyze(portalAlias, "/tmp/dummy", PortalAnalysisMode.QUICK),
    isStale: () => Promise.resolve(false),
    updateKnowledge: (portalAlias: string) =>
      mockKnowledge.analyze(portalAlias, "/tmp/dummy", PortalAnalysisMode.QUICK),
    getRelevantContext: () => Promise.resolve(undefined),
  };
  const mockKnowledgeConfig: IPortalKnowledgeConfig = {
    autoAnalyzeOnMount: false,
    defaultMode: PortalAnalysisMode.QUICK,
    quickScanLimit: 100,
    maxFilesToRead: 10,
    ignorePatterns: [],
    staleness: 168,
    useLlmInference: false,
    relevanceSearchEmbeddingEnabled: false,
  };

  const service = new PortalService(
    config,
    configService,
    contextCardGen,
    display,
    mockKnowledge,
    mockKnowledgeConfig,
  );

  // Create portals directory
  const portalsDir = join(tempDir, config.paths.portals);
  await ensureDir(portalsDir);

  // Create memory projects directory for context cards
  const memoryProjectsDir = join(tempDir, config.paths.memory, "Projects");
  await ensureDir(memoryProjectsDir);

  return {
    tempDir,
    config,
    configService,
    service,
    portalsDir,
    memoryProjectsDir,
    cleanup: async () => {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────────────────────────────

Deno.test("PortalService: validateAlias rejects empty alias", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    await assertRejects(
      () => service.add(tempDir, ""),
      Error,
      "Alias cannot be empty",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: validateAlias rejects alias starting with number", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    await assertRejects(
      () => service.add(tempDir, "123invalid"),
      Error,
      "cannot start with a number",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: validateAlias rejects invalid characters", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    await assertRejects(
      () => service.add(tempDir, "bad@alias"),
      Error,
      "invalid characters",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: validateAlias rejects reserved names", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    await assertRejects(
      () => service.add(tempDir, "System"),
      Error,
      "reserved",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: validateAlias rejects too-long alias", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    const longAlias = "a".repeat(200);
    await assertRejects(
      () => service.add(tempDir, longAlias),
      Error,
      "cannot exceed",
    );
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────
// add
// ──────────────────────────────────────────────────────────────────────

Deno.test("PortalService: add creates symlink and registers portal", async () => {
  const { service, cleanup, portalsDir, tempDir } = await createPortalTestEnv();
  try {
    // Create a target directory
    const targetDir = join(tempDir, "target-project");
    await Deno.mkdir(targetDir, { recursive: true });

    await service.add(targetDir, "myproject");

    // Verify symlink was created
    const symlinkPath = join(portalsDir, "myproject");
    const stat = await Deno.lstat(symlinkPath);
    assertEquals(stat.isSymlink, true);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: add rejects non-existent target", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    await assertRejects(
      () => service.add(join(tempDir, "nonexistent"), "myproject"),
      Error,
      "Target path does not exist",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: add rejects non-directory target", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    const targetFile = join(tempDir, "file.txt");
    await Deno.writeTextFile(targetFile, "not a dir");
    await assertRejects(
      () => service.add(targetFile, "myproject"),
      Error,
      "not a directory",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: add rejects duplicate alias", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "target-project");
    await Deno.mkdir(targetDir, { recursive: true });

    await service.add(targetDir, "myproject");

    await assertRejects(
      () => service.add(targetDir, "myproject"),
      Error,
      "already exists",
    );
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────
// list
// ──────────────────────────────────────────────────────────────────────

Deno.test("PortalService: list returns empty for no portals", async () => {
  const { service, cleanup } = await createPortalTestEnv();
  try {
    const list = await service.list();
    assertEquals(list, []);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: list returns added portals with ACTIVE status", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "project-1");
    await Deno.mkdir(targetDir, { recursive: true });

    await service.add(targetDir, "project-one");

    const list = await service.list();
    assertEquals(list.length, 1);
    assertEquals(list[0].alias, "project-one");
    assertEquals(list[0].status, PortalStatus.ACTIVE);
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────
// show
// ──────────────────────────────────────────────────────────────────────

Deno.test("PortalService: show returns details for existing portal", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "show-test");
    await Deno.mkdir(targetDir, { recursive: true });

    await service.add(targetDir, "showportal");

    const details = await service.show("showportal");
    assertEquals(details.alias, "showportal");
    assertEquals(details.status, PortalStatus.ACTIVE);
    assertEquals(details.permissions, "Read/Write");
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: show throws for non-existent portal", async () => {
  const { service, cleanup } = await createPortalTestEnv();
  try {
    await assertRejects(
      () => service.show("nonexistent"),
      Error,
      "not found",
    );
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────
// remove
// ──────────────────────────────────────────────────────────────────────

Deno.test("PortalService: remove deletes symlink", async () => {
  const { service, cleanup, tempDir, portalsDir } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "remove-test");
    await Deno.mkdir(targetDir, { recursive: true });

    await service.add(targetDir, "removeportal");

    // Verify symlink exists
    const symlinkPath = join(portalsDir, "removeportal");
    const stat = await Deno.lstat(symlinkPath);
    assertEquals(stat.isSymlink, true);

    await service.remove("removeportal", { keepCard: true });

    // Verify symlink is gone
    let exists = false;
    try {
      await Deno.lstat(symlinkPath);
      exists = true;
    } catch {
      exists = false;
    }
    assertEquals(exists, false);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: remove throws for non-existent portal", async () => {
  const { service, cleanup } = await createPortalTestEnv();
  try {
    await assertRejects(
      () => service.remove("nonexistent"),
      Error,
      "not found",
    );
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────
// verify
// ──────────────────────────────────────────────────────────────────────

Deno.test("PortalService: verify reports ok for healthy portal", async () => {
  const { service, cleanup, tempDir, memoryProjectsDir } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "verify-test");
    await Deno.mkdir(targetDir, { recursive: true });

    await service.add(targetDir, "verifyportal");

    // Create context card
    const portalContextDir = join(memoryProjectsDir, "verifyportal");
    await ensureDir(portalContextDir);
    await Deno.writeTextFile(join(portalContextDir, "portal.md"), "# Portal");

    const results = await service.verify("verifyportal");
    assertEquals(results.length, 1);
    assertEquals(results[0].status, "ok");
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: verify reports failed for broken portal", async () => {
  const { service, cleanup, tempDir, portalsDir } = await createPortalTestEnv();
  try {
    // Create a dangling symlink manually
    const deadTarget = join(tempDir, "dead-target");
    const symlinkPath = join(portalsDir, "brokenportal");
    await Deno.symlink(deadTarget, symlinkPath);

    const results = await service.verify("brokenportal");
    assertEquals(results.length, 1);
    assertEquals(results[0].status, "failed");
    assertEquals(Array.isArray(results[0].issues), true);
    assertEquals(results[0].issues!.length > 0, true);
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────
// refresh
// ──────────────────────────────────────────────────────────────────────

Deno.test("PortalService: refresh regenerates context card", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "refresh-test");
    await Deno.mkdir(targetDir, { recursive: true });

    await service.add(targetDir, "refreshportal");
    // Should not throw
    await service.refresh("refreshportal");
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: refresh throws for non-existent portal", async () => {
  const { service, cleanup } = await createPortalTestEnv();
  try {
    await assertRejects(
      () => service.refresh("nonexistent"),
      Error,
      "not found",
    );
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────
// remove without keepCard (archives context card)
// ──────────────────────────────────────────────────────────────────────

Deno.test("PortalService: remove without keepCard archives context card", async () => {
  const { service, cleanup, tempDir, portalsDir, memoryProjectsDir } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "remove-archive-test");
    await Deno.mkdir(targetDir, { recursive: true });

    await service.add(targetDir, "archiveable");

    // Create context card
    const portalContextDir = join(memoryProjectsDir, "archiveable");
    await ensureDir(portalContextDir);
    await Deno.writeTextFile(join(portalContextDir, "portal.md"), "# Portal Context");

    // Remove WITHOUT keepCard (default) — should archive the context card
    await service.remove("archiveable");

    // Symlink should be gone
    let symlinkExists = false;
    try {
      await Deno.lstat(join(portalsDir, "archiveable"));
      symlinkExists = true;
    } catch { /* expected */ }
    assertEquals(symlinkExists, false);

    // Context card should have been moved to _archived
    const archivedDir = join(memoryProjectsDir, "_archived");
    let archivedExists = false;
    try {
      for await (const entry of Deno.readDir(archivedDir)) {
        if (entry.name.startsWith("archiveable_")) {
          archivedExists = true;
          break;
        }
      }
    } catch { /* directory may not exist */ }
    assertEquals(archivedExists, true);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: remove without keepCard handles missing context card gracefully", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "remove-no-card-test");
    await Deno.mkdir(targetDir, { recursive: true });

    await service.add(targetDir, "nocard");

    // Don't create context card — remove should still succeed
    await service.remove("nocard");
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────
// add with defaultBranch
// ──────────────────────────────────────────────────────────────────────

Deno.test("PortalService: add with valid defaultBranch succeeds", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "branch-test");
    await Deno.mkdir(targetDir, { recursive: true });

    await service.add(targetDir, "branchportal", {
      defaultBranch: "develop",
      executionStrategy: PortalExecutionStrategy.WORKTREE,
    });

    const details = await service.show("branchportal");
    assertEquals(details.alias, "branchportal");
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: add with invalid defaultBranch rejects", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "bad-branch-test");
    await Deno.mkdir(targetDir, { recursive: true });

    await assertRejects(
      () => service.add(targetDir, "badbranch", { defaultBranch: "invalid..branch" }),
      Error,
      "not a safe git branch name",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: add with empty defaultBranch rejects", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "empty-branch-test");
    await Deno.mkdir(targetDir, { recursive: true });

    await assertRejects(
      () => service.add(targetDir, "emptybranch", { defaultBranch: "" }),
      Error,
      "must be non-empty string",
    );
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────
// list with broken symlinks
// ──────────────────────────────────────────────────────────────────────

Deno.test("PortalService: list includes broken symlinks with BROKEN status", async () => {
  const { service, cleanup, tempDir, portalsDir } = await createPortalTestEnv();
  try {
    // Create a dangling symlink
    const deadTarget = join(tempDir, "deleted-target");
    await Deno.symlink(deadTarget, join(portalsDir, "brokenlink"));

    const list = await service.list();
    assertEquals(list.length, 1);
    assertEquals(list[0].alias, "brokenlink");
    assertEquals(list[0].status, PortalStatus.BROKEN);
    assertEquals(list[0].targetPath, "(unknown)");
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────
// show with broken symlink
// ──────────────────────────────────────────────────────────────────────

Deno.test("PortalService: show returns BROKEN status for dangling symlink", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    // Create target, add portal, then delete target
    const targetDir = join(tempDir, "will-be-deleted");
    await Deno.mkdir(targetDir, { recursive: true });
    await service.add(targetDir, "willbreak");

    // Delete the target directory
    await Deno.remove(targetDir, { recursive: true });

    const details = await service.show("willbreak");
    assertEquals(details.alias, "willbreak");
    assertEquals(details.status, PortalStatus.BROKEN);
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────
// verify all portals (no alias parameter)
// ──────────────────────────────────────────────────────────────────────

Deno.test("PortalService: verify all portals when no alias given", async () => {
  const { service, cleanup, tempDir, memoryProjectsDir } = await createPortalTestEnv();
  try {
    // Add two portals
    const target1 = join(tempDir, "project-1");
    const target2 = join(tempDir, "project-2");
    await Deno.mkdir(target1, { recursive: true });
    await Deno.mkdir(target2, { recursive: true });

    await service.add(target1, "portalA");
    await service.add(target2, "portalB");

    // Create context cards for both
    for (const alias of ["portalA", "portalB"]) {
      const dir = join(memoryProjectsDir, alias);
      await ensureDir(dir);
      await Deno.writeTextFile(join(dir, "portal.md"), "# Portal");
    }

    // Verify ALL (no alias)
    const results = await service.verify();
    assertEquals(results.length, 2);
    assertEquals(results.every((r) => r.status === "ok"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: verify detects missing config entry", async () => {
  const { service, cleanup, tempDir, configService } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "unconfig-test");
    await Deno.mkdir(targetDir, { recursive: true });
    await service.add(targetDir, "unconfigured");

    // Remove the portal from config but keep the symlink
    await configService.removePortal("unconfigured");

    const results = await service.verify("unconfigured");
    assertEquals(results.length, 1);
    assertEquals(results[0].status, "failed");
    assertEquals(results[0].issues!.some((i: string) => i.includes("not found in configuration")), true);
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: analyze delegates to portalKnowledge", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "analyze-test");
    await Deno.mkdir(targetDir, { recursive: true });
    await service.add(targetDir, "testportal");

    const result = await service.analyze("testportal");
    assertStringIncludes(result, "Portal: testportal");
    assertStringIncludes(result, "Mode:   quick");
  } finally {
    await cleanup();
  }
});

Deno.test("PortalService: getKnowledge delegates to portalKnowledge", async () => {
  const { service, cleanup, tempDir } = await createPortalTestEnv();
  try {
    const targetDir = join(tempDir, "knowledge-test");
    await Deno.mkdir(targetDir, { recursive: true });
    await service.add(targetDir, "testportal");

    const result = await service.getKnowledge("testportal");
    assertEquals(result, null);
  } finally {
    await cleanup();
  }
});
