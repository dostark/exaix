/**
 * @module PortalKnowledgeConfigBuilderTest
 * @path packages/portal/knowledge/tests/portal_knowledge_config_test.ts
 * @description Tests for buildPortalKnowledgeConfig (Phase 178 Step 2): the shared
 * mapper both composition roots call, including the Enterprise symbol-level flag.
 */

import { ExaPathDefaults } from "@exaix/shared";
import { assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";
import { LogLevel, PortalAnalysisMode } from "@exaix/core";
import { buildPortalKnowledgeConfig } from "@exaix/portal/knowledge";

type PortalKnowledgeSectionOverrides = Partial<{
  default_mode: string;
  quick_scan_limit: number;
  max_files_to_read: number;
  staleness_hours: number;
  enable_symbol_level_dependency_graph: boolean;
}>;

function parseSection(overrides: PortalKnowledgeSectionOverrides = {}) {
  const result = ConfigSchema.safeParse({
    system: { root: "/tmp/exa-p178-config", log_level: LogLevel.INFO },
    paths: ExaPathDefaults,
    portal_knowledge: { default_mode: "standard", ...overrides },
  });
  if (!result.success) throw new Error(`config fixture invalid: ${result.error.message}`);
  return result.data.portal_knowledge!;
}

Deno.test("[buildPortalKnowledgeConfig] follows enable_symbol_level_dependency_graph from the config section", () => {
  assertEquals(
    buildPortalKnowledgeConfig(parseSection()).enableSymbolLevelDependencyGraph,
    false,
  );
  assertEquals(
    buildPortalKnowledgeConfig(parseSection({ enable_symbol_level_dependency_graph: true }))
      .enableSymbolLevelDependencyGraph,
    true,
  );
});

Deno.test("[buildPortalKnowledgeConfig] maps the section's mode, scan limits, and staleness", () => {
  const config = buildPortalKnowledgeConfig(parseSection({
    default_mode: "deep",
    quick_scan_limit: 321,
    max_files_to_read: 45,
    staleness_hours: 12,
  }));

  assertEquals(config.defaultMode, PortalAnalysisMode.DEEP);
  assertEquals(config.quickScanLimit, 321);
  assertEquals(config.maxFilesToRead, 45);
  assertEquals(config.staleness, 12);
});

Deno.test("[buildPortalKnowledgeConfig] resolves each optional boolean to a concrete value", () => {
  const config = buildPortalKnowledgeConfig(parseSection());
  for (
    const [key, value] of Object.entries({
      relevanceSearchEmbeddingEnabled: config.relevanceSearchEmbeddingEnabled,
      enableAstAnalysis: config.enableAstAnalysis,
      enableTestExecution: config.enableTestExecution,
      enableVulnerabilityScan: config.enableVulnerabilityScan,
      enableGitHistoryAnalysis: config.enableGitHistoryAnalysis,
      enableSymbolLevelDependencyGraph: config.enableSymbolLevelDependencyGraph,
    })
  ) {
    assertEquals(typeof value, "boolean", `${key} must resolve to a boolean`);
  }
});
