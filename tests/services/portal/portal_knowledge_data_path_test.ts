/**
 * @module PortalKnowledgeDataPathTest
 * @path tests/services/portal_knowledge_data_path_test.ts
 * @description Tests for the PortalService.getKnowledge() method that loads
 * IPortalKnowledge from knowledge.json via the TUI/CLI data path.
 * @related-files [src/services/portal.ts, src/shared/interfaces/i_portal_service.ts, src/services/portal_knowledge/knowledge_persistence.ts]
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { PortalService } from "../../../src/services/portal.ts";
import { ExaPathDefaults } from "../../../src/shared/constants.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { createStubConfig, createStubDisplay } from "../../helpers/test_helpers.ts";
import type { IContextCardGeneratorService } from "../../../src/shared/interfaces/i_context_card_generator_service.ts";
import type { IPortalKnowledge } from "../../../src/shared/schemas/portal_knowledge.ts";
import { PortalAnalysisMode } from "../../../src/shared/enums.ts";

function makeMockContextCardGenerator(): IContextCardGeneratorService {
  return { generate: () => Promise.resolve() };
}

async function makePortalKnowledgePathEnv() {
  const tempDir = await Deno.makeTempDir({ prefix: "portal-knowledge-path-" });
  const config = createMockConfig(tempDir);
  const service = new PortalService(
    config,
    createStubConfig(config),
    makeMockContextCardGenerator(),
    createStubDisplay(),
  );
  const projectsDir = join(tempDir, ExaPathDefaults.memoryProjects);
  const portalsDir = join(tempDir, ExaPathDefaults.portals);
  await ensureDir(projectsDir);
  await ensureDir(portalsDir);

  return {
    tempDir,
    config,
    service,
    projectsDir,
    portalsDir,
    cleanup: () => Deno.remove(tempDir, { recursive: true }).catch(() => {}),
  };
}

function makeMinimalKnowledge(portalAlias: string): IPortalKnowledge {
  return {
    portal: portalAlias,
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "## Overview\nTest codebase.",
    layers: [],
    keyFiles: [],
    conventions: [],
    dependencies: [],
    packages: undefined,
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [],
    stats: {
      totalFiles: 5,
      totalDirectories: 2,
      extensionDistribution: { ".ts": 5 },
    },
    metadata: {
      durationMs: 100,
      mode: PortalAnalysisMode.QUICK,
      filesScanned: 5,
      filesRead: 3,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

Deno.test("[PortalService] getKnowledge returns knowledge for analyzed portal", async () => {
  const { projectsDir, portalsDir, tempDir, service, cleanup } = await makePortalKnowledgePathEnv();
  const alias = "my-portal";
  const knowledge = makeMinimalKnowledge(alias);

  // Create dummy target and symlink
  const targetDir = join(tempDir, "target");
  await ensureDir(targetDir);
  await Deno.symlink(targetDir, join(portalsDir, alias));

  // Pre-write knowledge.json
  const portalDir = join(projectsDir, alias);
  await ensureDir(portalDir);
  await Deno.writeTextFile(join(portalDir, "knowledge.json"), JSON.stringify(knowledge));

  try {
    const result = await service.getKnowledge(alias);
    assertExists(result, "should return knowledge object");
    assertEquals(result.portal, alias);
    assertEquals(result.architectureOverview, knowledge.architectureOverview);
  } finally {
    await cleanup();
  }
});

Deno.test("[PortalService] getKnowledge returns null for unanalyzed portal", async () => {
  const { portalsDir, tempDir, service, cleanup } = await makePortalKnowledgePathEnv();
  const alias = "unanalyzed-portal";

  // Create dummy target and symlink
  const targetDir = join(tempDir, "unanalyzed-target");
  await ensureDir(targetDir);
  await Deno.symlink(targetDir, join(portalsDir, alias));

  try {
    const result = await service.getKnowledge(alias);
    assertEquals(result, null);
  } finally {
    await cleanup();
  }
});

Deno.test("[PortalService] getKnowledge throws if portal not found", async () => {
  const { service, cleanup } = await makePortalKnowledgePathEnv();
  try {
    await assertRejects(
      () => service.getKnowledge("nonexistent-portal"),
      Error,
      "not found",
    );
  } finally {
    await cleanup();
  }
});
