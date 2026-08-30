/**
 * @module FlowStrategyAuditTest
 * @path tests/blueprints/flow_strategy_audit_test.ts
 * @description Cross-checks Phase 159 Step 7's flow catalog strategy audit table (recorded in
 *   exaix-dev-docs/planning/phase-159-flow-step-execution-strategy.md) against a live
 *   enumeration of Blueprints/Flows/*.flow.yaml, so no step in the shipped catalog silently
 *   lacks an explicit strategy decision and no flow's strategy assignment regresses unnoticed.
 */
import { assertEquals } from "@std/assert";
import { FlowLoader } from "@exaix/flow";
import { FlowValidatorImpl } from "@exaix/flow";
import { FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import type { IFlowStep } from "@exaix/schemas/flow.ts";

const FLOWS_DIR = "./Blueprints/Flows";
const BLUEPRINTS_DIR = "./Blueprints";

/** Mechanism-proof fixtures — not part of the shipped 17-flow/96-step catalog. */
const NON_CATALOG_FIXTURES = new Set([
  "strategy-comparison-cli-delegate.flow.yaml",
  "strategy-comparison-react.flow.yaml",
  "strategy-routing-smoke.flow.yaml",
]);

type Decision = "react" | "cli_delegate" | "no-strategy" | "n/a-dynamic" | "session_delegate_cycle";

/** Mirrors the "Flow catalog strategy audit table" in phase-159-flow-step-execution-strategy.md. */
const AUDIT_TABLE: Record<string, Record<string, Decision>> = {
  "analyze-codebase": { "explore": "n/a-dynamic", "write-report": "no-strategy" },
  "api-design": {
    "gather-requirements": "no-strategy",
    "design-architecture": "no-strategy",
    "define-endpoints": "no-strategy",
    "design-schemas": "no-strategy",
    "security-design": "no-strategy",
    "error-handling": "no-strategy",
    "performance-considerations": "no-strategy",
    "compile-api-spec": "no-strategy",
  },
  "api-documentation": {
    "api-analysis": "react",
    "endpoint-documentation": "no-strategy",
    "data-models": "no-strategy",
    "authentication-docs": "no-strategy",
    "examples-integration": "no-strategy",
    "documentation-review": "no-strategy",
  },
  "bug-investigation": {
    "analyze-bug-report": "no-strategy",
    "locate-relevant-code": "react",
    "identify-root-cause": "react",
    "security-impact": "no-strategy",
    "propose-fix": "react",
    "write-test-cases": "react",
    "compile-report": "no-strategy",
  },
  "code-review": {
    "analyze-code": "react",
    "security-review": "no-strategy",
    "performance-review": "no-strategy",
    "final-report": "no-strategy",
  },
  "consensus-review": {
    "candidate-architecture": "no-strategy",
    "candidate-security": "no-strategy",
    "consensus": "no-strategy",
  },
  "documentation": {
    "extract-code-structure": "react",
    "generate-api-docs": "no-strategy",
    "generate-user-guide": "no-strategy",
    "generate-architecture-docs": "no-strategy",
    "compile-documentation": "no-strategy",
  },
  "dogfood-loop": { "implement": "cli_delegate", "review": "react" },
  "dogfood-meta-workflow": { "pre-gap": "react", "next-steps": "session_delegate_cycle", "post-gap": "react" },
  "feature-development": {
    "analyze-requirements": "cli_delegate",
    "design-architecture": "cli_delegate",
    "implement-feature": "cli_delegate",
    "write-tests": "cli_delegate",
    "code-review": "cli_delegate",
    "integration-test": "cli_delegate",
  },
  "migration-planning": {
    "gather-requirements": "no-strategy",
    "analyze-current-state": "react",
    "impact-analysis": "no-strategy",
    "breaking-changes": "no-strategy",
    "risk-assessment": "no-strategy",
    "security-considerations": "no-strategy",
    "create-migration-plan": "no-strategy",
    "testing-strategy": "no-strategy",
    "generate-documentation": "no-strategy",
  },
  "onboarding-docs": {
    "analyze-project-structure": "react",
    "identify-key-concepts": "no-strategy",
    "generate-quickstart": "no-strategy",
    "generate-architecture-overview": "no-strategy",
    "generate-dev-setup": "no-strategy",
    "generate-contribution-guide": "no-strategy",
    "generate-glossary": "no-strategy",
    "compile-onboarding-docs": "no-strategy",
  },
  "pr-review": {
    "diff-analysis": "react",
    "code-quality-review": "no-strategy",
    "security-review": "no-strategy",
    "performance-review": "no-strategy",
    "test-coverage-review": "no-strategy",
    "documentation-review": "no-strategy",
    "consolidate-feedback": "no-strategy",
    "generate-pr-report": "no-strategy",
  },
  "refactoring": {
    "analyze-current-code": "cli_delegate",
    "identify-improvements": "cli_delegate",
    "assess-risks": "cli_delegate",
    "write-safety-tests": "cli_delegate",
    "implement-refactoring": "cli_delegate",
    "validate-refactoring": "cli_delegate",
    "final-review": "cli_delegate",
  },
  "research-synthesis": { "synthesize": "no-strategy", "assess-quality": "no-strategy" },
  "security-audit": {
    "static-analysis": "react",
    "dependency-audit": "react",
    "auth-review": "react",
    "data-protection": "react",
    "consolidate-findings": "no-strategy",
    "risk-assessment": "no-strategy",
    "remediation-plan": "react",
    "generate-report": "no-strategy",
  },
  "test-generation": {
    "analyze-code-structure": "react",
    "identify-test-scenarios": "no-strategy",
    "generate-unit-tests": "react",
    "generate-integration-tests": "react",
    "identify-edge-cases": "no-strategy",
    "generate-edge-case-tests": "react",
    "review-test-quality": "no-strategy",
    "compile-test-suite": "no-strategy",
  },
};

async function listCatalogFlowIds(): Promise<string[]> {
  const ids: string[] = [];
  for await (const entry of Deno.readDir(FLOWS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".flow.yaml") || NON_CATALOG_FIXTURES.has(entry.name)) continue;
    ids.push(entry.name.replace(".flow.yaml", ""));
  }
  return ids;
}

function actualDecision(step: IFlowStep): Decision {
  if (step.type === FlowStepType.SESSION_DELEGATE_CYCLE) return "session_delegate_cycle";
  if (step.execution_mode === FlowStepExecutionMode.DYNAMIC) return "n/a-dynamic";
  if (step.strategy === "react") return "react";
  if (step.strategy === "cli_delegate") return "cli_delegate";
  return "no-strategy";
}

Deno.test("Flow strategy audit: catalog enumeration matches the audit table's 17 flows", async () => {
  const liveIds = (await listCatalogFlowIds()).sort();
  const tableIds = Object.keys(AUDIT_TABLE).sort();
  assertEquals(liveIds, tableIds);
  assertEquals(liveIds.length, 17, `expected 17 production flows, found ${liveIds.length}`);
});

Deno.test("Flow strategy audit: every catalog step has an explicit, recorded decision matching reality", async () => {
  const loader = new FlowLoader(FLOWS_DIR);
  const missing: string[] = [];
  const mismatches: string[] = [];
  let totalSteps = 0;

  for (const flowId of await listCatalogFlowIds()) {
    const flow = await loader.loadFlow(flowId);
    const flowTable = AUDIT_TABLE[flowId] ?? {};
    for (const step of flow.steps) {
      totalSteps++;
      const expected = flowTable[step.id];
      if (expected === undefined) {
        missing.push(`${flowId}.${step.id}`);
        continue;
      }
      const actual = actualDecision(step);
      if (actual !== expected) {
        mismatches.push(`${flowId}.${step.id}: expected ${expected}, found ${actual}`);
      }
    }
  }

  assertEquals(missing, [], `steps with no recorded audit decision: ${missing.join(", ")}`);
  assertEquals(mismatches, [], `steps whose actual strategy diverges from the audit table: ${mismatches.join(", ")}`);
  assertEquals(totalSteps, 96, `expected 96 steps across the 17-flow catalog, found ${totalSteps}`);
});

Deno.test("Flow strategy audit: audit table totals match the recorded 22/14/1/58/1 split", () => {
  const counts: Record<Decision, number> = {
    "react": 0,
    "cli_delegate": 0,
    "no-strategy": 0,
    "n/a-dynamic": 0,
    "session_delegate_cycle": 0,
  };
  for (const flowTable of Object.values(AUDIT_TABLE)) {
    for (const decision of Object.values(flowTable)) {
      counts[decision]++;
    }
  }
  assertEquals(counts["react"], 22);
  assertEquals(counts["cli_delegate"], 14);
  assertEquals(counts["n/a-dynamic"], 1);
  assertEquals(counts["no-strategy"], 58);
  assertEquals(counts["session_delegate_cycle"], 1);
});

Deno.test("Flow strategy audit: every catalog flow still validates after the strategy rollout", async () => {
  const loader = new FlowLoader(FLOWS_DIR);
  const validator = new FlowValidatorImpl(loader, BLUEPRINTS_DIR);
  const invalid: string[] = [];

  for (const flowId of await listCatalogFlowIds()) {
    const result = await validator.validateFlow(flowId);
    if (!result.valid) {
      invalid.push(`${flowId}: ${result.error}`);
    }
  }

  assertEquals(invalid, [], `flows that no longer validate after the strategy rollout: ${invalid.join(", ")}`);
});
