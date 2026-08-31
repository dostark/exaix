#!/usr/bin/env -S deno run --allow-all
/**
 * @module CallToolRegistryTool
 * @path tests/scenario_framework/scripts/call_tool_registry_tool.ts
 * @architectural-layer Test
 * @description Scenario-facing wrapper that constructs a real ToolRegistry (wired to a real
 *   PortalKnowledgeService, matching the daemon's production IApplicationContext wiring) and
 *   invokes one Solo-tier ReAct tool directly, printing the result as JSON. Solo tools have no
 *   MCP handler (packages/tool-runtime/src/tool_registry.ts is a separate catalog from
 *   packages/mcp/src/manifest.ts — see ARCHITECTURE.md's "Tool Catalog Parity"), so
 *   call_mcp_tool.ts's stdio-transport approach does not apply; this calls execute() in-process.
 * @dependencies [packages/tool-runtime/src/tool_registry.ts, packages/portal/knowledge/portal_knowledge_service.ts]
 * @related-files [tests/scenario_framework/scripts/call_mcp_tool.ts]
 */

import { ToolRegistry } from "@exaix/tool-runtime";
import { PortalKnowledgeService } from "@exaix/portal/knowledge";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { PortalAnalysisMode } from "@exaix/core";
import type {
  IApplicationContext,
  IDatabaseService,
  IMemoryBankService,
  IPortalKnowledgeConfig,
} from "@exaix/core/types";
import type { IDisplayService } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import { createGitServiceStub, createProviderStub } from "@exaix/testing/helpers/stub_factories.ts";
import { join } from "@std/path";

const NOOP_DISPLAY: IDisplayService = {
  info: () => Promise.resolve(),
  warn: () => Promise.resolve(),
  error: () => Promise.resolve(),
  debug: () => Promise.resolve(),
  fatal: () => Promise.resolve(),
};

/** Only `portalKnowledge`/`config` are read by query_relationships/who_depends_on; the rest
 *  of IApplicationContext is stubbed to satisfy the interface, matching flow_runner.ts's
 *  established stubbing idiom for a context this narrow. */
function makeContext(portalKnowledge: PortalKnowledgeService, config: Config): IApplicationContext {
  return {
    portalKnowledge,
    config: {
      get: () => config,
      getAll: () => config,
      getConfigPath: () => "",
      reload: () => config,
      getSchemaVersion: () => "1.0.0",
      getPortals: () => [],
      getPortal: () => undefined,
      addPortal: () => Promise.resolve(),
      removePortal: () => Promise.resolve(),
    },
    db: {} as IDatabaseService,
    provider: createProviderStub(),
    git: createGitServiceStub(),
    display: NOOP_DISPLAY,
  } as IApplicationContext;
}

function usageError(): never {
  console.error(
    "Usage: call_tool_registry_tool.ts <workspace-root> <portal-alias> <portal-path> <tool-name> <args-json>",
  );
  Deno.exit(1);
}

if (import.meta.main) {
  const [workspaceRoot, portalAlias, portalPath, toolName, argsJson] = Deno.args;
  if (!workspaceRoot || !portalAlias || !portalPath || !toolName || !argsJson) usageError();

  let params: Record<string, JSONValue>;
  try {
    params = JSON.parse(argsJson);
  } catch {
    console.error(`Failed to parse args-json: ${argsJson}`);
    Deno.exit(1);
  }

  const config = ConfigSchema.parse({
    system: { root: workspaceRoot },
    paths: {},
    database: {},
    watcher: {},
    agents: {},
    models: {},
    portals: [{
      alias: portalAlias,
      target_path: portalPath,
      default_branch: "main",
      identities_allowed: ["*"],
      operations: [],
    }],
    mcp: {},
  });

  const pkConfig: IPortalKnowledgeConfig = {
    autoAnalyzeOnMount: false,
    defaultMode: PortalAnalysisMode.STANDARD,
    quickScanLimit: 200,
    maxFilesToRead: 30,
    ignorePatterns: [],
    staleness: 24,
    useLlmInference: false,
    relevanceSearchEmbeddingEnabled: false,
    maxPatternDetectorSampleSize: 50,
    minPatternDetectorSampleSize: 10,
    enableAstAnalysis: true,
    enableTestExecution: false,
    enableVulnerabilityScan: false,
    enableGitHistoryAnalysis: false,
    gitHistoryCommitLimit: 20,
    gitHistorySince: "3.months",
  };

  const portalKnowledge = new PortalKnowledgeService({
    config: pkConfig,
    memoryBank: {} as IMemoryBankService,
    projectsDir: join(workspaceRoot, "Memory", "Projects"),
  });

  const context = makeContext(portalKnowledge, config);
  const registry = new ToolRegistry({ config, baseDir: portalPath, context });

  const result = await registry.execute(toolName, params);
  console.log(JSON.stringify(result, null, 2));
  Deno.exit(result.success ? 0 : 1);
}
