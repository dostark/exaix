/**
 * @module PortalKnowledgeCliTest
 * @path tests/cli/commands/portal_knowledge_cli_test.ts
 * @description Tests for the `analyze` and `knowledge` CLI subcommands added to
 * PortalCommands (Step 15 of Phase 46). Covers analysis trigger, mode flag,
 * force re-analysis, formatted/JSON knowledge output, and graceful error handling.
 * @related-files [src/cli/commands/portal_commands.ts, src/services/portal_knowledge/knowledge_persistence.ts]
 */

import { assert, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { PortalCommands } from "../../../src/cli/commands/portal_commands.ts";
import type {
  IPortalKnowledgeConfig,
  IPortalKnowledgeService,
} from "../../../src/shared/interfaces/i_portal_knowledge_service.ts";
import type { IPortalKnowledge } from "../../../src/shared/schemas/portal_knowledge.ts";
import { PortalAnalysisMode } from "../../../src/shared/enums.ts";
import { ExaPathDefaults } from "../../../src/shared/constants.ts";
import { initPortalTest } from "../helpers/test_setup.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeKnowledge(alias = "my-portal"): IPortalKnowledge {
  return {
    portal: alias,
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "## Overview\nA TypeScript service layer.",
    layers: [],
    keyFiles: [
      { path: "src/main.ts", role: "entrypoint", description: "Entry point" },
    ],
    conventions: [
      {
        name: "Service suffix",
        description: "Services use _service.ts suffix",
        evidenceCount: 5,
        confidence: "high",
        examples: ["auth_service.ts"],
        category: "naming",
      },
    ],
    dependencies: [
      {
        packageManager: "deno",
        configFile: "deno.json",
        keyDependencies: [{ name: "@std/assert", purpose: "Assertions" }],
      },
    ],
    packages: undefined,
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [],
    stats: { totalFiles: 10, totalDirectories: 3, extensionDistribution: { ".ts": 10 } },
    metadata: {
      durationMs: 120,
      mode: "quick",
      filesScanned: 10,
      filesRead: 3,
    },
  };
}

function makeMockKnowledgeService(
  knowledge: IPortalKnowledge,
  opts: { failAnalyze?: boolean } = {},
): IPortalKnowledgeService & {
  analyzeCallCount: number;
  lastMode: PortalAnalysisMode | undefined;
  updateCallCount: number;
} {
  let analyzeCallCount = 0;
  let lastMode: PortalAnalysisMode | undefined;
  let updateCallCount = 0;
  return {
    get analyzeCallCount() {
      return analyzeCallCount;
    },
    get lastMode() {
      return lastMode;
    },
    get updateCallCount() {
      return updateCallCount;
    },
    analyze(_alias: string, _path: string, mode?: PortalAnalysisMode) {
      analyzeCallCount++;
      lastMode = mode;
      if (opts.failAnalyze) return Promise.reject(new Error("Analysis failed"));
      return Promise.resolve(knowledge);
    },
    getOrAnalyze(_alias: string, _path: string) {
      return Promise.resolve(knowledge);
    },
    isStale(_alias: string) {
      return Promise.resolve(false);
    },
    updateKnowledge(_alias: string, _path: string) {
      updateCallCount++;
      return Promise.resolve(knowledge);
    },
  };
}

function makeKnowledgeConfig(): IPortalKnowledgeConfig {
  return {
    autoAnalyzeOnMount: false,
    defaultMode: PortalAnalysisMode.QUICK,
    quickScanLimit: 50,
    maxFilesToRead: 10,
    ignorePatterns: [],
    staleness: 168,
    useLlmInference: false,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: write knowledge.json for a portal alias
// ──────────────────────────────────────────────────────────────────────────────
async function writeKnowledge(
  tempRoot: string,
  alias: string,
  knowledge: IPortalKnowledge,
): Promise<void> {
  const dir = join(tempRoot, ExaPathDefaults.memoryProjects, alias);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, "knowledge.json"), JSON.stringify(knowledge));
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests: `portal analyze`
// ──────────────────────────────────────────────────────────────────────────────

Deno.test("[portal analyze] triggers analysis and displays summary", async () => {
  const alias = "analyze-portal";
  const knowledge = makeKnowledge(alias);
  const mockService = makeMockKnowledgeService(knowledge);
  const { tempRoot: _tr, targetDir, context, cleanup } = await initPortalTest({
    createTarget: true,
    portalKnowledge: mockService,
  });
  try {
    context.portalKnowledgeConfig = makeKnowledgeConfig();

    const commands = new PortalCommands(context);
    await commands.add(targetDir, alias);

    const summary = await commands.analyze(alias);

    assert(mockService.analyzeCallCount === 1, "analyze() should be called once");
    assertStringIncludes(summary, alias);
    assertStringIncludes(summary, "10"); // filesScanned
  } finally {
    await cleanup();
  }
});

Deno.test("[portal analyze] uses specified mode", async () => {
  const alias = "mode-portal";
  const knowledge = makeKnowledge(alias);
  const mockService = makeMockKnowledgeService(knowledge);
  const { tempRoot: _r, targetDir, context, cleanup } = await initPortalTest({
    createTarget: true,
    portalKnowledge: mockService,
  });
  try {
    context.portalKnowledgeConfig = makeKnowledgeConfig();
    context.portalKnowledgeConfig = makeKnowledgeConfig();

    const commands = new PortalCommands(context);
    await commands.add(targetDir, alias);

    await commands.analyze(alias, { mode: PortalAnalysisMode.DEEP });

    assert(
      mockService.lastMode === PortalAnalysisMode.DEEP,
      "analyze() should receive the specified mode",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[portal analyze] force re-analyzes fresh knowledge", async () => {
  const alias = "force-portal";
  const knowledge = makeKnowledge(alias);
  const mockService = makeMockKnowledgeService(knowledge);
  const { tempRoot, targetDir, context, cleanup } = await initPortalTest({
    createTarget: true,
    portalKnowledge: mockService,
  });
  try {
    context.portalKnowledgeConfig = makeKnowledgeConfig();
    context.portalKnowledgeConfig = makeKnowledgeConfig();

    const commands = new PortalCommands(context);
    await commands.add(targetDir, alias);

    // Pre-write knowledge so it is fresh
    await writeKnowledge(tempRoot, alias, knowledge);

    // Force flag should still call analyze
    await commands.analyze(alias, { force: true });

    assert(mockService.analyzeCallCount >= 1, "analyze() should be called with --force");
  } finally {
    await cleanup();
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: `portal knowledge`
// ──────────────────────────────────────────────────────────────────────────────

Deno.test("[portal knowledge] displays formatted knowledge", async () => {
  const { tempRoot, targetDir, context, cleanup } = await initPortalTest({ createTarget: true });
  try {
    const alias = "knowledge-portal";
    const knowledge = makeKnowledge(alias);
    const commands = new PortalCommands(context);
    await commands.add(targetDir, alias);
    await writeKnowledge(tempRoot, alias, knowledge);

    const output = await commands.knowledge(alias);

    assertStringIncludes(output, "TypeScript service layer");
    assertStringIncludes(output, "src/main.ts");
  } finally {
    await cleanup();
  }
});

Deno.test("[portal knowledge] outputs raw JSON with --json flag", async () => {
  const { tempRoot, targetDir, context, cleanup } = await initPortalTest({ createTarget: true });
  try {
    const alias = "json-portal";
    const knowledge = makeKnowledge(alias);
    const commands = new PortalCommands(context);
    await commands.add(targetDir, alias);
    await writeKnowledge(tempRoot, alias, knowledge);

    const output = await commands.knowledge(alias, { json: true });
    const parsed: IPortalKnowledge = JSON.parse(output);

    assert(parsed.portal === alias, "JSON output should contain the portal alias");
  } finally {
    await cleanup();
  }
});

Deno.test("[portal knowledge] handles missing portal gracefully", async () => {
  const { context, cleanup } = await initPortalTest({ createTarget: false });
  try {
    const commands = new PortalCommands(context);

    await assertRejects(
      () => commands.knowledge("nonexistent-portal"),
      Error,
      "not found",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[portal knowledge] handles unanalyzed portal gracefully", async () => {
  const { targetDir, context, cleanup } = await initPortalTest({ createTarget: true });
  try {
    const alias = "unanalyzed-portal";
    const commands = new PortalCommands(context);
    await commands.add(targetDir, alias);

    // No knowledge.json written
    const output = await commands.knowledge(alias);

    assertStringIncludes(output, "No knowledge");
    assertStringIncludes(output, "exactl portal analyze");
  } finally {
    await cleanup();
  }
});
