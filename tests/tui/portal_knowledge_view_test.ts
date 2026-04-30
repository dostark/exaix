/**
 * @module PortalKnowledgeViewTest
 * @path tests/tui/portal_knowledge_view_test.ts
 * @description Tests for portal knowledge rendering functions in PortalManagerTuiSession:
 * displays architecture overview, key files, conventions, dependencies, and
 * the no-analysis fallback message. Also verifies the 'a' keybinding triggers
 * re-analysis via service.getKnowledge().
 * @related-files [src/tui/portal_manager_view.ts, "packages/core/src/types/i_portal_service.ts", "packages/schemas/src/portal_knowledge.ts"]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { PortalManagerTuiSession, renderKnowledgeSection } from "../../src/tui/portal_manager_view.ts";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import type { IPortalService } from "@exaix/core/types";
import { PortalStatus, SystemCommand } from "@exaix/core";
import type { IPortalInfo } from "@exaix/core/types/portal.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

function makeKnowledge(overrides: Partial<IPortalKnowledge> = {}): IPortalKnowledge {
  return {
    portal: "test-portal",
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "## Architecture\nThis is a TypeScript service codebase.\nIt uses hexagonal architecture.",
    layers: [{ name: "Services", paths: ["src/services"], responsibility: "Business logic", keyFiles: [] }],
    keyFiles: [
      { path: "src/main.ts", role: "entrypoint", description: "App entry point" },
      { path: "src/services/auth.ts", role: "core-service", description: "Auth" },
    ],
    conventions: [
      {
        name: "Service naming",
        description: "Services use .ts suffix",
        evidenceCount: 8,
        confidence: "high",
        examples: ["auth.ts"],
        category: "naming",
      },
      {
        name: "Test layout",
        description: "Tests mirror src/",
        evidenceCount: 15,
        confidence: "high",
        examples: ["tests/"],
        category: "testing",
      },
    ],
    dependencies: [
      {
        packageManager: SystemCommand.DENO,
        configFile: "deno.json",
        keyDependencies: [{ name: "std/path", version: "0.224.0", purpose: "File path utilities" }],
      },
    ],
    packages: undefined,
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [],
    stats: {
      totalFiles: 20,
      totalDirectories: 5,
      extensionDistribution: { ".ts": 18, ".json": 2 },
    },
    metadata: {
      durationMs: 200,
      mode: "quick" as const,
      filesScanned: 20,
      filesRead: 10,
    },
    ...overrides,
  };
}

function makePortalInfo(alias = "test-portal"): IPortalInfo {
  return {
    alias,
    status: PortalStatus.ACTIVE,
    targetPath: `/tmp/${alias}`,
    symlinkPath: `/links/${alias}`,
    contextCardPath: "",
  };
}

function makeMockService(knowledge: IPortalKnowledge | null = null): IPortalService & { callCount: number } {
  let callCount = 0;
  return {
    get callCount() {
      return callCount;
    },
    add: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    listPortals: () => Promise.resolve([]),
    show: () => Promise.resolve({} as never),
    getPortalDetails: () => Promise.resolve({} as never),
    remove: () => Promise.resolve(),
    removePortal: () => Promise.resolve(true),
    verify: () => Promise.resolve([]),
    refresh: () => Promise.resolve(),
    refreshPortal: () => Promise.resolve(true),
    openPortal: () => Promise.resolve(true),
    closePortal: () => Promise.resolve(true),
    quickJumpToPortalDir: () => Promise.resolve(""),
    getPortalFilesystemPath: () => Promise.resolve(""),
    getPortalActivityLog: () => [],
    getKnowledge: (_alias: string) => {
      callCount++;
      return Promise.resolve(knowledge);
    },
    analyze: (_alias: string, _options?: Parameters<IPortalService["analyze"]>[1]) => Promise.resolve("Mock analysis"),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Unit tests: renderKnowledgeSection()
// ──────────────────────────────────────────────────────────────────────────────

Deno.test("[PortalKnowledgeView] displays architecture overview", () => {
  const knowledge = makeKnowledge({ architectureOverview: "## Architecture\nHexagonal pattern.\n" });
  const lines = renderKnowledgeSection(knowledge);
  const text = lines.join("\n");
  assertStringIncludes(text, "Hexagonal pattern");
  assertStringIncludes(text, "Architecture");
});

Deno.test("[PortalKnowledgeView] displays key files table", () => {
  const knowledge = makeKnowledge();
  const lines = renderKnowledgeSection(knowledge);
  const text = lines.join("\n");
  assertStringIncludes(text, "src/main.ts");
  assertStringIncludes(text, "entrypoint");
  assertStringIncludes(text, "src/services/auth.ts");
});

Deno.test("[PortalKnowledgeView] displays conventions by category", () => {
  const knowledge = makeKnowledge();
  const lines = renderKnowledgeSection(knowledge);
  const text = lines.join("\n");
  assertStringIncludes(text, "Service naming");
  assertStringIncludes(text, "naming");
  assertStringIncludes(text, "testing");
});

Deno.test("[PortalKnowledgeView] displays dependencies with purpose", () => {
  const knowledge = makeKnowledge();
  const lines = renderKnowledgeSection(knowledge);
  const text = lines.join("\n");
  assertStringIncludes(text, "std/path");
  assertStringIncludes(text, "File path utilities");
});

Deno.test("[PortalKnowledgeView] shows no-analysis message when missing", () => {
  const lines = renderKnowledgeSection(null);
  const text = lines.join("\n");
  assertStringIncludes(text, "No analysis available");
  assertStringIncludes(text, "exactl portal analyze");
});

// ──────────────────────────────────────────────────────────────────────────────
// Integration tests: keybinding 'a' in PortalManagerTuiSession
// ──────────────────────────────────────────────────────────────────────────────

Deno.test("[PortalKnowledgeView] keybinding a triggers re-analysis", async () => {
  const knowledge = makeKnowledge();
  const service = makeMockService(knowledge);
  const portal = makePortalInfo("test-portal");
  const session = new PortalManagerTuiSession([portal], service);

  // Select the portal first
  session.setSelectedIndex(0);

  // Press 'a' — should trigger getKnowledge for selected portal
  const handled = await session.handleKey("a");
  assert(handled, "key 'a' should be handled");
  assertEquals(service.callCount, 1, "getKnowledge should be called once");
});
