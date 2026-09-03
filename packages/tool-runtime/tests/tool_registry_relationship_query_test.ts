/**
 * @module ToolRegistryRelationshipQueryTest
 * @path packages/tool-runtime/tests/tool_registry_relationship_query_test.ts
 * @description Phase 175 Step 5 — verifies the Solo-tier query_relationships/who_depends_on
 * tools: registered on ToolRegistry, callable end to end against a portal-knowledge context,
 * and gracefully erroring (never throwing) when no portal-knowledge service or no matching
 * portal is configured.
 * @architectural-layer Services
 * @related-files [packages/tool-runtime/src/tool_registry.ts, packages/portal/knowledge/relationship_query.ts]
 */

import { assertEquals } from "@std/assert";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";
import { ToolName } from "@exaix/core";
import type { IApplicationContext, IPortalKnowledgeService } from "@exaix/core/types";
import { PortalAnalysisMode } from "@exaix/core";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";

const PORTAL_ALIAS = "test-portal";

function makeKnowledge(): IPortalKnowledge {
  return {
    portal: PORTAL_ALIAS,
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "# Test",
    layers: [{
      name: "services",
      paths: ["services/"],
      responsibility: "Business logic",
      keyFiles: ["services/main.ts"],
    }],
    keyFiles: [],
    conventions: [],
    dependencies: [],
    packages: undefined,
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [],
    relationships: [{ from: "main.ts", to: "util.ts", kind: "file_imports_file_internal" }],
    stats: { totalFiles: 0, totalDirectories: 0, extensionDistribution: {} },
    metadata: { durationMs: 0, mode: PortalAnalysisMode.STANDARD, filesScanned: 0, filesRead: 0 },
  };
}

function makeMockKnowledgeService(knowledge: IPortalKnowledge): IPortalKnowledgeService {
  return {
    analyze: () => Promise.resolve(knowledge),
    getOrAnalyze: () => Promise.resolve(knowledge),
    isStale: () => Promise.resolve(false),
    updateKnowledge: () => Promise.resolve(knowledge),
    getRelevantContext: () => Promise.resolve(undefined),
  } as IPortalKnowledgeService;
}

function makeContext(
  config: ReturnType<typeof createMockConfig>,
  service: IPortalKnowledgeService,
): IApplicationContext {
  return {
    portalKnowledge: service,
    config: { get: () => config, getAll: () => config },
  } as IApplicationContext;
}

Deno.test("[ToolRegistry] query_relationships and who_depends_on are registered", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-relq-registered-" });
  try {
    const config = createMockConfig(dir, {
      portals: [{
        alias: PORTAL_ALIAS,
        target_path: dir,
        default_branch: "main",
        agents_allowed: ["*"],
        operations: [],
      }],
    });
    const registry = new ToolRegistry({ config, baseDir: dir });
    const names = registry.getTools().map((t) => t.name);
    assertEquals(names.includes(ToolName.QUERY_RELATIONSHIPS), true);
    assertEquals(names.includes(ToolName.WHO_DEPENDS_ON), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry] query_relationships returns edges from the current portal's knowledge", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-relq-query-" });
  try {
    const knowledge = makeKnowledge();
    const config = createMockConfig(dir, {
      portals: [{
        alias: PORTAL_ALIAS,
        target_path: dir,
        default_branch: "main",
        agents_allowed: ["*"],
        operations: [],
      }],
    });
    const context = makeContext(config, makeMockKnowledgeService(knowledge));
    const registry = new ToolRegistry({ config, baseDir: dir, context });

    const result = await registry.execute(ToolName.QUERY_RELATIONSHIPS, { from: "services" });
    assertEquals(result.success, true);
    assertEquals(result.data, [{ from: "services", to: "services/main.ts", kind: "layer_contains_file" }]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry] who_depends_on returns reverse edges from the current portal's knowledge", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-relq-whodep-" });
  try {
    const knowledge = makeKnowledge();
    const config = createMockConfig(dir, {
      portals: [{
        alias: PORTAL_ALIAS,
        target_path: dir,
        default_branch: "main",
        agents_allowed: ["*"],
        operations: [],
      }],
    });
    const context = makeContext(config, makeMockKnowledgeService(knowledge));
    const registry = new ToolRegistry({ config, baseDir: dir, context });

    const result = await registry.execute(ToolName.WHO_DEPENDS_ON, { path: "util.ts" });
    assertEquals(result.success, true);
    assertEquals(result.data, [{ from: "main.ts", to: "util.ts", kind: "file_imports_file_internal" }]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry] query_relationships errors gracefully when no portal-knowledge service is configured", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-relq-noservice-" });
  try {
    const config = createMockConfig(dir, {
      portals: [{
        alias: PORTAL_ALIAS,
        target_path: dir,
        default_branch: "main",
        agents_allowed: ["*"],
        operations: [],
      }],
    });
    const registry = new ToolRegistry({ config, baseDir: dir });

    const result = await registry.execute(ToolName.QUERY_RELATIONSHIPS, { from: "services" });
    assertEquals(result.success, false);
    assertEquals(typeof result.error, "string");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry] who_depends_on errors gracefully when baseDir matches no configured portal", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-relq-noportal-" });
  try {
    const knowledge = makeKnowledge();
    const config = createMockConfig(dir, { portals: [] });
    const context = makeContext(config, makeMockKnowledgeService(knowledge));
    const registry = new ToolRegistry({ config, baseDir: dir, context });

    const result = await registry.execute(ToolName.WHO_DEPENDS_ON, { path: "util.ts" });
    assertEquals(result.success, false);
    assertEquals(typeof result.error, "string");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
