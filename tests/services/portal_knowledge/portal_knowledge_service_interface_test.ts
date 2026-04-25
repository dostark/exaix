/**
 * @module IPortalKnowledgeServiceInterfaceTest
 * @path tests/services/portal_knowledge/portal_knowledge_service_interface_test.ts
 * @description Type-level and structural tests for IPortalKnowledgeService and
 * IPortalKnowledgeConfig. Verifies that the interface contract is complete,
 * that a conforming mock implementation satisfies the TypeScript compiler, and
 * that all config fields are present with correct types.
 */

import { assertEquals } from "@std/assert";
import { PortalAnalysisMode } from "@exaix/core";
import type {
  IPortalKnowledgeConfig,
  IPortalKnowledgeService,
} from "../../../src/shared/interfaces/i_portal_knowledge_service.ts";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";

// ---------------------------------------------------------------------------
// Minimal stub that must satisfy the full IPortalKnowledgeService contract.
// If any method is missing or has the wrong signature, this file fails to
// type-check — which is the RED/GREEN signal for this interface step.
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// IPortalKnowledgeConfig — verify all required fields exist with correct types
// ---------------------------------------------------------------------------

const validConfig: IPortalKnowledgeConfig = {
  autoAnalyzeOnMount: false,
  defaultMode: PortalAnalysisMode.QUICK,
  quickScanLimit: 200,
  maxFilesToRead: 50,
  ignorePatterns: ["node_modules", ".git"],
  staleness: 168,
  useLlmInference: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
