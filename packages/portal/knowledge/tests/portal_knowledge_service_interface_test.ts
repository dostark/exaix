/**
 * @module IPortalKnowledgeServiceInterfaceTest
 * @path packages/portal/knowledge/tests/portal_knowledge_service_interface_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Type-level and structural tests for IPortalKnowledgeService and
 * IPortalKnowledgeConfig. Verifies that the interface contract is complete,
 * that a conforming mock implementation satisfies the TypeScript compiler, and
 * that all config fields are present with correct types.
 */

import { assertEquals } from "@std/assert";
import { PortalAnalysisMode } from "@exaix/core/types";
import type {
  IPortalContextQuery,
  IPortalKnowledgeConfig,
  IPortalKnowledgeService,
  IScoredContextResult,
} from "@exaix/core/types";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";

// Minimal stub that must satisfy the full IPortalKnowledgeService contract — a missing
// method or wrong signature fails `deno check` right here.

class StubPortalKnowledgeService implements IPortalKnowledgeService {
  analyze(
    _portalAlias: string,
    _portalPath: string,
    _mode?: PortalAnalysisMode,
  ): Promise<IPortalKnowledge> {
    return Promise.reject(new Error("stub"));
  }

  getOrAnalyze(
    _portalAlias: string,
    _portalPath: string,
  ): Promise<IPortalKnowledge> {
    return Promise.reject(new Error("stub"));
  }

  isStale(_portalAlias: string): Promise<boolean> {
    return Promise.reject(new Error("stub"));
  }

  updateKnowledge(
    _portalAlias: string,
    _portalPath: string,
    _changedFiles?: string[],
  ): Promise<IPortalKnowledge> {
    return Promise.reject(new Error("stub"));
  }

  getRelevantContext(
    _requestText: string,
    _portalPath: string,
    _maxTokens: number,
  ): Promise<string | undefined> {
    return Promise.reject(new Error("stub"));
  }

  queryContext(_query: IPortalContextQuery): Promise<IScoredContextResult> {
    return Promise.reject(new Error("stub"));
  }

  loadCachedKnowledge(_portalAlias: string): Promise<IPortalKnowledge | undefined> {
    return Promise.reject(new Error("stub"));
  }
}

// IPortalKnowledgeConfig — verify all required fields exist with correct types

const validConfig: IPortalKnowledgeConfig = {
  autoAnalyzeOnMount: false,
  defaultMode: PortalAnalysisMode.QUICK,
  quickScanLimit: 200,
  maxFilesToRead: 50,
  ignorePatterns: ["node_modules", ".git"],
  staleness: 168,
  useLlmInference: true,
  relevanceSearchEmbeddingEnabled: false,
  maxPatternDetectorSampleSize: 50,
  minPatternDetectorSampleSize: 10,
  enableAstAnalysis: true,
  enableTestExecution: false,
  enableVulnerabilityScan: false,
  enableGitHistoryAnalysis: true,
  gitHistoryCommitLimit: 500,
  gitHistorySince: "1.year",
};

// Tests

Deno.test("[IPortalKnowledgeService] stub satisfies interface contract", () => {
  const svc: IPortalKnowledgeService = new StubPortalKnowledgeService();
  assertEquals(typeof svc.analyze, "function");
  assertEquals(typeof svc.getOrAnalyze, "function");
  assertEquals(typeof svc.isStale, "function");
  assertEquals(typeof svc.updateKnowledge, "function");
});

Deno.test("[IPortalKnowledgeConfig] all fields present with correct types", () => {
  assertEquals(typeof validConfig.autoAnalyzeOnMount, "boolean");
  assertEquals(typeof validConfig.defaultMode, "string");
  assertEquals(typeof validConfig.quickScanLimit, "number");
  assertEquals(typeof validConfig.maxFilesToRead, "number");
  assertEquals(Array.isArray(validConfig.ignorePatterns), true);
  assertEquals(typeof validConfig.staleness, "number");
  assertEquals(typeof validConfig.useLlmInference, "boolean");
});

Deno.test("[IPortalKnowledgeConfig] defaultMode accepts all valid modes", () => {
  const modes: PortalAnalysisMode[] = [
    PortalAnalysisMode.QUICK,
    PortalAnalysisMode.STANDARD,
    PortalAnalysisMode.DEEP,
  ];
  for (const mode of modes) {
    const cfg: IPortalKnowledgeConfig = { ...validConfig, defaultMode: mode };
    assertEquals(cfg.defaultMode, mode);
  }
});

Deno.test("[IPortalKnowledgeService] analyze signature accepts optional mode", () => {
  const svc: IPortalKnowledgeService = new StubPortalKnowledgeService();
  // Verify the method exists and is callable with 2 or 3 args (compile-time check)
  assertEquals(typeof svc.analyze, "function");
  // Type-safe: both call shapes must be accepted by the TypeScript compiler
  const fn: IPortalKnowledgeService["analyze"] = svc.analyze.bind(svc);
  assertEquals(typeof fn, "function");
});

Deno.test("[IPortalKnowledgeService] updateKnowledge accepts optional changedFiles", () => {
  const svc: IPortalKnowledgeService = new StubPortalKnowledgeService();
  assertEquals(typeof svc.updateKnowledge, "function");
  const fn: IPortalKnowledgeService["updateKnowledge"] = svc.updateKnowledge.bind(svc);
  assertEquals(typeof fn, "function");
});
